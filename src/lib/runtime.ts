import { getConfig } from "@/lib/config";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getStore, updateStore } from "@/lib/store";
import type { PersonalUser, Workspace } from "@/lib/types";

const CURSOR_PURPOSE = "runtime-cursor-key";
const GITHUB_PURPOSE = "runtime-github-token";

export type AgentRuntime = {
  cursorApiKey: string;
  githubToken: string;
  githubOrg: string;
  /** Base URL Cursor's cloud uses to reach our MCP and file endpoints; empty when unreachable. */
  agentPublicUrl: string;
  cursorSource: "workspace" | "env" | "none";
};

function reachable(url: string) {
  const trimmed = url.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  try {
    const { hostname, protocol } = new URL(trimmed);
    if (protocol !== "https:" && protocol !== "http:") return "";
    if (hostname === "localhost" || hostname === "0.0.0.0" || hostname.startsWith("127.")) return "";
  } catch {
    return "";
  }
  return trimmed;
}

/** Credentials an agent in this workspace runs with. Workspace settings win over env vars, as a set. */
export function runtimeFor(workspace: Workspace | undefined): AgentRuntime {
  const cfg = getConfig();
  const r = workspace?.runtime;
  const ownKey = workspace && r?.cursorApiKeyEnc ? decryptSecret(r.cursorApiKeyEnc, CURSOR_PURPOSE, workspace.id) : "";
  const ownGithub = workspace && r?.githubTokenEnc ? decryptSecret(r.githubTokenEnc, GITHUB_PURPOSE, workspace.id) : "";
  return {
    cursorApiKey: ownKey || cfg.cursorApiKey,
    githubToken: ownGithub || cfg.githubToken,
    githubOrg: ownGithub ? (r?.githubOrg ?? "") : cfg.githubOrg,
    agentPublicUrl: reachable(r?.agentPublicUrl || "") || reachable(cfg.publicUrl),
    cursorSource: ownKey ? "workspace" : cfg.cursorApiKey ? "env" : "none",
  };
}

export async function runtimeForUser(user: Pick<PersonalUser, "workspaceId"> | undefined) {
  const store = await getStore();
  return runtimeFor(user?.workspaceId ? store.workspaces[user.workspaceId] : undefined);
}

export async function runtimeForUserId(userId: string) {
  const store = await getStore();
  return runtimeFor(store.workspaces[store.users[userId]?.workspaceId ?? ""]);
}

async function cursorIdentity(key: string) {
  const res = await fetch("https://api.cursor.com/v0/me", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
  if (!res) return { error: "Could not reach api.cursor.com." };
  if (res.status === 401 || res.status === 403) return { error: "Cursor rejected this API key." };
  if (!res.ok) return { error: `Cursor returned HTTP ${res.status} for this key.` };
  const body = (await res.json().catch(() => ({}))) as { userEmail?: string; apiKeyName?: string };
  return { label: [body.userEmail, body.apiKeyName].filter(Boolean).join(" · ") || "Cursor key" };
}

async function githubIdentity(token: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "personal-agents-control-plane",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
  if (!res) return { error: "Could not reach api.github.com." };
  if (!res.ok) return { error: res.status === 401 ? "GitHub rejected this token." : `GitHub returned HTTP ${res.status}.` };
  const body = (await res.json().catch(() => ({}))) as { login?: string };
  return { label: body.login ? `@${body.login}` : "GitHub token" };
}

const tail = (secret: string) => `…${secret.slice(-4)}`;

/**
 * Saves the owner's credentials after checking them with Cursor and GitHub.
 * Empty strings leave a value unchanged; `clear` removes it.
 */
export async function updateAgentRuntime(
  ownerUserId: string,
  workspaceId: string,
  input: {
    cursorApiKey?: string;
    githubToken?: string;
    githubOrg?: string;
    agentPublicUrl?: string;
    clear?: "cursor" | "github";
  },
): Promise<{ ok: true } | { error: string }> {
  const cursorApiKey = input.cursorApiKey?.trim() ?? "";
  const githubToken = input.githubToken?.trim() ?? "";
  const publicUrl = input.agentPublicUrl?.trim().replace(/\/$/, "") ?? "";
  const githubOrg = input.githubOrg?.trim() ?? "";

  if (publicUrl && !reachable(publicUrl)) {
    return { error: "The public URL must be an http(s) address Cursor's cloud can reach (not localhost)." };
  }
  if (githubOrg && !/^[A-Za-z0-9-]{1,39}$/.test(githubOrg)) return { error: "That isn't a valid GitHub organization name." };

  const cursor = cursorApiKey ? await cursorIdentity(cursorApiKey) : undefined;
  if (cursor && "error" in cursor) return { error: cursor.error! };
  const github = githubToken ? await githubIdentity(githubToken) : undefined;
  if (github && "error" in github) return { error: github.error! };

  const saved = await updateStore((store) => {
    const ws = store.workspaces[workspaceId];
    if (!ws || ws.ownerUserId !== ownerUserId) return false;
    const r = (ws.runtime ??= {});
    if (input.clear === "cursor") {
      delete r.cursorApiKeyEnc;
      delete r.cursorKeyLabel;
    }
    if (input.clear === "github") {
      delete r.githubTokenEnc;
      delete r.githubTokenLabel;
    }
    if (cursor && "label" in cursor) {
      r.cursorApiKeyEnc = encryptSecret(cursorApiKey, CURSOR_PURPOSE, ws.id);
      r.cursorKeyLabel = `${cursor.label} · key ${tail(cursorApiKey)}`;
    }
    if (github && "label" in github) {
      r.githubTokenEnc = encryptSecret(githubToken, GITHUB_PURPOSE, ws.id);
      r.githubTokenLabel = `${github.label} · token ${tail(githubToken)}`;
    }
    if (input.githubOrg !== undefined) r.githubOrg = githubOrg || undefined;
    if (input.agentPublicUrl !== undefined) r.agentPublicUrl = publicUrl || undefined;
    r.updatedAt = new Date().toISOString();
    ws.updatedAt = r.updatedAt;
    return true;
  });
  return saved ? { ok: true } : { error: "Workspace not found." };
}
