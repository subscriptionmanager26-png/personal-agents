import crypto from "node:crypto";

import { getConfig } from "@/lib/config";
import { getRedis, updateStore, getStore } from "@/lib/store";
import { saveSlackInstall } from "@/lib/slack-install";

const BOT_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "files:read",
  "files:write",
  "users:read",
  "users:read.email",
  "reactions:write",
  "channels:read",
  "groups:read",
  "im:read",
].join(",");

/** Sign-in with Slack (user token) for control-plane sessions. */
const USER_SCOPES = ["identity.basic", "identity.email", "identity.avatar"].join(
  ",",
);

const STATE_PREFIX = "pa:slack:oauth-state:";

function redirectBase() {
  const { publicUrl } = getConfig();
  if (!publicUrl) throw new Error("PUBLIC_URL is required for Slack OAuth");
  return publicUrl;
}

async function saveState(state: string, kind: string) {
  const redis = getRedis();
  if (redis) {
    await redis.set(`${STATE_PREFIX}${state}`, kind, { ex: 600 });
    return;
  }
  await updateStore((store) => {
    (
      store as unknown as { oauthStates?: Record<string, { kind: string; at: number }> }
    ).oauthStates ??= {};
    (
      store as unknown as {
        oauthStates: Record<string, { kind: string; at: number }>;
      }
    ).oauthStates[state] = { kind, at: Date.now() };
  });
}

async function takeState(state: string) {
  const redis = getRedis();
  if (redis) {
    const kind = await redis.get<string>(`${STATE_PREFIX}${state}`);
    if (!kind) return null;
    await redis.del(`${STATE_PREFIX}${state}`);
    return kind;
  }
  return updateStore((store) => {
    const states = (
      store as unknown as {
        oauthStates?: Record<string, { kind: string; at: number }>;
      }
    ).oauthStates;
    const row = states?.[state];
    if (!row) return null;
    delete states![state];
    if (Date.now() - row.at > 600_000) return null;
    return row.kind;
  });
}

export async function beginWorkspaceInstall() {
  const cfg = getConfig();
  if (!cfg.slackClientId) throw new Error("SLACK_CLIENT_ID is not configured");
  const state = crypto.randomBytes(24).toString("base64url");
  await saveState(state, "workspace");
  const params = new URLSearchParams({
    client_id: cfg.slackClientId,
    scope: BOT_SCOPES,
    redirect_uri: `${redirectBase()}/api/slack/oauth/callback`,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export async function beginUserSignIn() {
  const cfg = getConfig();
  if (!cfg.slackClientId) throw new Error("SLACK_CLIENT_ID is not configured");
  const state = crypto.randomBytes(24).toString("base64url");
  await saveState(state, "signin");
  const params = new URLSearchParams({
    client_id: cfg.slackClientId,
    user_scope: USER_SCOPES,
    redirect_uri: `${redirectBase()}/api/auth/slack/callback`,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export async function finishWorkspaceOAuth(input: {
  code: string;
  state: string;
}) {
  const kind = await takeState(input.state);
  if (kind !== "workspace") throw new Error("Invalid OAuth state");
  const cfg = getConfig();
  const body = new URLSearchParams({
    client_id: cfg.slackClientId,
    client_secret: cfg.slackClientSecret,
    code: input.code,
    redirect_uri: `${redirectBase()}/api/slack/oauth/callback`,
  });
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
    authed_user?: { id?: string };
    scope?: string;
  };
  if (!data.ok || !data.access_token || !data.team?.id) {
    throw new Error(data.error || "workspace oauth failed");
  }
  await saveSlackInstall({
    teamId: data.team.id,
    teamName: data.team.name,
    botToken: data.access_token,
    botUserId: data.bot_user_id || "",
    installedByUserId: data.authed_user?.id,
    scopes: data.scope?.split(",") ?? [],
  });
  return data.team;
}

export async function finishUserSignIn(input: {
  code: string;
  state: string;
}) {
  const kind = await takeState(input.state);
  if (kind !== "signin") throw new Error("Invalid OAuth state");
  const cfg = getConfig();
  const body = new URLSearchParams({
    client_id: cfg.slackClientId,
    client_secret: cfg.slackClientSecret,
    code: input.code,
    redirect_uri: `${redirectBase()}/api/auth/slack/callback`,
  });
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    authed_user?: { id?: string; access_token?: string };
    team?: { id?: string };
  };
  if (!data.ok || !data.authed_user?.access_token || !data.authed_user.id) {
    throw new Error(data.error || "signin oauth failed");
  }
  const identityRes = await fetch("https://slack.com/api/users.identity", {
    headers: { Authorization: `Bearer ${data.authed_user.access_token}` },
  });
  const identity = (await identityRes.json()) as {
    ok: boolean;
    user?: {
      id: string;
      name?: string;
      email?: string;
      image_72?: string;
    };
    team?: { id?: string };
    error?: string;
  };
  if (!identity.ok || !identity.user) {
    throw new Error(identity.error || "identity failed");
  }
  const teamId = identity.team?.id || data.team?.id;
  if (!teamId) throw new Error("Missing team id from Slack identity");
  return {
    teamId,
    userId: identity.user.id,
    displayName: identity.user.name,
    email: identity.user.email,
    avatarUrl: identity.user.image_72,
  };
}

/** Dev helper: no-op read to keep store import used when Redis absent. */
export async function debugOAuthStateCount() {
  const store = await getStore();
  return Object.keys(
    (
      store as unknown as {
        oauthStates?: Record<string, unknown>;
      }
    ).oauthStates || {},
  ).length;
}
