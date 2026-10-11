import crypto from "node:crypto";

import { getConfig } from "@/lib/config";
import { getSlackInstallBotToken } from "@/lib/slack-install";

export function verifySlackSignature(input: {
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
}) {
  const secret = getConfig().slackSigningSecret;
  if (!secret) return false;
  if (!input.signature || !input.timestamp) return false;
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;
  const base = `v0:${input.timestamp}:${input.rawBody}`;
  const digest =
    "v0=" +
    crypto.createHmac("sha256", secret).update(base).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function postSlackMessage(input: {
  teamId: string;
  channel: string;
  threadTs?: string;
  text: string;
}) {
  const token = await getSlackInstallBotToken(input.teamId);
  if (!token) throw new Error(`No Slack bot token for team ${input.teamId}`);
  if (token.startsWith("xoxb-mock")) {
    console.info("[mock-slack]", input.channel, input.threadTs, input.text.slice(0, 200));
    return `mock-${Date.now()}`;
  }
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      thread_ts: input.threadTs,
      text: input.text,
      unfurl_links: false,
      unfurl_media: false,
    }),
    cache: "no-store",
  });
  const data = (await response.json()) as {
    ok: boolean;
    ts?: string;
    error?: string;
  };
  if (!data.ok) throw new Error(`Slack chat.postMessage: ${data.error}`);
  return data.ts;
}

export async function fetchSlackUser(input: {
  teamId: string;
  userId: string;
}) {
  const token = await getSlackInstallBotToken(input.teamId);
  if (!token) return undefined;
  const url = new URL("https://slack.com/api/users.info");
  url.searchParams.set("user", input.userId);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = (await response.json()) as {
    ok: boolean;
    user?: {
      id: string;
      name?: string;
      real_name?: string;
      profile?: { email?: string; image_72?: string; display_name?: string };
    };
  };
  if (!data.ok || !data.user) return undefined;
  return {
    displayName:
      data.user.profile?.display_name ||
      data.user.real_name ||
      data.user.name,
    email: data.user.profile?.email,
    avatarUrl: data.user.profile?.image_72,
  };
}

export function stripBotMention(text: string) {
  return text.replace(/<@[A-Z0-9]+>/gi, "").trim();
}
