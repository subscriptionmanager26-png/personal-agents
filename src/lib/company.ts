import crypto from "node:crypto";

import { SignJWT, decodeJwt, jwtVerify } from "jose";

import { decryptSecret, encryptSecret, randomId, sha256 } from "@/lib/crypto";
import type { McpServerDef } from "@/lib/cursor-api";
import { getStore, updateStore } from "@/lib/store";
import type { ApiKey, CompanyServer, PersonalUser, Workspace } from "@/lib/types";
import { appendAudit, publicUser } from "@/lib/users";
import { normalizeMcpUrl, slugify } from "@/lib/workspaces";

const SIGNING_PURPOSE = "workspace-mcp-signing";
const TOKEN_ISSUER = "personal-agents";
const EXTERNAL_ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const RESERVED_SERVER_NAMES = new Set(["personal-agent", "personal-vault"]);

// ---------- API keys ----------

function hashSecret(secret: string) {
  return sha256(secret).toString("hex");
}

/** Store a pre-generated `pa_<id>_<secret>` key if the workspace has none yet (e.g. from POCKETEDGE_API_KEY env). */
export async function registerApiKeyFromPlaintext(
  ownerUserId: string,
  workspaceId: string,
  fullKey: string,
  label: string,
) {
  const match = fullKey.match(/^pa_([a-f0-9]{12})_([A-Za-z0-9_-]{20,})$/);
  if (!match) return false;
  const [, id, secret] = match;
  const record: ApiKey = {
    id,
    label: label.trim().slice(0, 60) || "API key",
    hash: hashSecret(secret),
    createdAt: new Date().toISOString(),
  };
  const ok = await updateStore((store) => {
    const ws = store.workspaces[workspaceId];
    if (!ws || ws.ownerUserId !== ownerUserId) return false;
    if ((ws.apiKeys ?? []).some((k) => k.id === id)) return true;
    (ws.apiKeys ??= []).push(record);
    return true;
  });
  return ok;
}

/** Returns the full key once; only its hash is stored. Format: pa_<keyId>_<secret>. */
export async function createApiKey(ownerUserId: string, workspaceId: string, label: string) {
  const id = crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(24).toString("base64url");
  const record: ApiKey = {
    id,
    label: label.trim().slice(0, 60) || "API key",
    hash: hashSecret(secret),
    createdAt: new Date().toISOString(),
  };
  const ok = await updateStore((store) => {
    const ws = store.workspaces[workspaceId];
    if (!ws || ws.ownerUserId !== ownerUserId) return false;
    (ws.apiKeys ??= []).push(record);
    return true;
  });
  if (!ok) return undefined;
  await appendAudit({ ownerUserId, type: "api_key.create", detail: `Created key ${id}` });
  return { key: `pa_${id}_${secret}`, record };
}

export async function revokeApiKey(ownerUserId: string, workspaceId: string, keyId: string) {
  const ok = await updateStore((store) => {
    const ws = store.workspaces[workspaceId];
    if (!ws || ws.ownerUserId !== ownerUserId) return false;
    const before = ws.apiKeys?.length ?? 0;
    ws.apiKeys = (ws.apiKeys ?? []).filter((k) => k.id !== keyId);
    return ws.apiKeys.length !== before;
  });
  if (ok) await appendAudit({ ownerUserId, type: "api_key.revoke", detail: `Revoked key ${keyId}` });
  return ok;
}

const API_KEY_CACHE_MS = 60_000;
const apiKeyCache = new Map<string, { workspace: Workspace; exp: number }>();

/** Resolves the workspace for an `Authorization: Bearer pa_…` header. */
export async function authenticateApiKey(authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+pa_([a-f0-9]{12})_([A-Za-z0-9_-]{20,})$/);
  if (!match) return undefined;
  const [, keyId, secret] = match;
  const cacheKey = `${keyId}:${hashSecret(secret)}`;
  const hit = apiKeyCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.workspace;

  const store = await getStore();
  const expected = Buffer.from(hashSecret(secret), "hex");
  for (const ws of Object.values(store.workspaces)) {
    const key = ws.apiKeys?.find((k) => k.id === keyId);
    if (!key) continue;
    const actual = Buffer.from(key.hash, "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return undefined;
    const stale = !key.lastUsedAt || Date.now() - Date.parse(key.lastUsedAt) > 60_000;
    if (stale) {
      await updateStore((s) => {
        const k = s.workspaces[ws.id]?.apiKeys?.find((x) => x.id === keyId);
        if (k) k.lastUsedAt = new Date().toISOString();
      });
    }
    if (apiKeyCache.size > 64) apiKeyCache.clear();
    apiKeyCache.set(cacheKey, { workspace: ws, exp: Date.now() + API_KEY_CACHE_MS });
    return ws;
  }
  return undefined;
}

// ---------- Company MCP servers + per-user tokens ----------

export async function addCompanyServer(
  ownerUserId: string,
  workspaceId: string,
  input: { name: string; url: string; description?: string },
): Promise<{ server: CompanyServer } | { error: string }> {
  const url = normalizeMcpUrl(input.url);
  const name = slugify(input.name, 40);
  if (!url || !name) return { error: "Enter a name and an http(s) MCP URL without credentials in it." } as const;
  if (RESERVED_SERVER_NAMES.has(name)) return { error: "That name is reserved." } as const;
  const server: CompanyServer = {
    id: randomId("srv"),
    name,
    url,
    description: input.description?.trim().slice(0, 300) || undefined,
  };
  const ok = await updateStore((store) => {
    const ws = store.workspaces[workspaceId];
    if (!ws || ws.ownerUserId !== ownerUserId) return "missing" as const;
    if ((ws.companyServers ?? []).some((s) => s.name === name)) return "taken" as const;
    (ws.companyServers ??= []).push(server);
    ws.updatedAt = new Date().toISOString();
    return "ok" as const;
  });
  if (ok === "taken") return { error: "A server with that name already exists." } as const;
  if (ok === "missing") return { error: "Workspace not found." } as const;
  await appendAudit({ ownerUserId, type: "company_server.add", detail: `Added ${name} (${new URL(url).host})` });
  return { server } as const;
}

export async function deleteCompanyServer(ownerUserId: string, workspaceId: string, serverId: string) {
  return updateStore((store) => {
    const ws = store.workspaces[workspaceId];
    if (!ws || ws.ownerUserId !== ownerUserId) return false;
    ws.companyServers = (ws.companyServers ?? []).filter((s) => s.id !== serverId);
    return true;
  });
}

/** Creates the workspace signing secret on first use; `rotate` replaces it. */
export async function ensureSigningSecret(ownerUserId: string, workspaceId: string, rotate = false) {
  const secret = await updateStore((store) => {
    const ws = store.workspaces[workspaceId];
    if (!ws || ws.ownerUserId !== ownerUserId) return undefined;
    if (ws.mcpSigningSecretEnc && !rotate) return decryptSecret(ws.mcpSigningSecretEnc, SIGNING_PURPOSE, ws.id);
    const fresh = crypto.randomBytes(32).toString("base64url");
    ws.mcpSigningSecretEnc = encryptSecret(fresh, SIGNING_PURPOSE, ws.id);
    return fresh;
  });
  if (secret && rotate) {
    await appendAudit({ ownerUserId, type: "signing_secret.rotate", detail: `Rotated for ${workspaceId}` });
  }
  return secret;
}

export function signingSecretFor(workspace: Workspace) {
  return workspace.mcpSigningSecretEnc
    ? decryptSecret(workspace.mcpSigningSecretEnc, SIGNING_PURPOSE, workspace.id)
    : undefined;
}

/** The user id the company knows: its own id for API users, ours otherwise. */
export function companyUserId(user: Pick<PersonalUser, "id" | "externalId">) {
  return user.externalId ?? user.id;
}

/**
 * Short-lived HS256 token identifying one user to one company MCP server.
 * The company verifies it with the workspace signing secret and checks `aud`.
 */
export async function createCompanyUserToken(workspace: Workspace, user: PersonalUser, audience: string) {
  const secret = signingSecretFor(workspace);
  if (!secret) throw new Error("Workspace signing secret is not set up");
  return new SignJWT({ ws: workspace.slug })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setSubject(companyUserId(user))
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("3h")
    .sign(new TextEncoder().encode(secret));
}

/** What a company MCP server does with the bearer token (used by the local mock servers). */
export async function verifyCompanyUserToken(token: string, secret: string, audience: string) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: TOKEN_ISSUER,
    audience,
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || typeof payload.ws !== "string") throw new Error("Invalid token");
  return { userId: payload.sub, workspace: payload.ws };
}

/** Reads the unverified `ws` claim so a multi-tenant server can pick the right secret. */
export function peekTokenWorkspace(token: string) {
  try {
    const ws = decodeJwt(token).ws;
    return typeof ws === "string" ? ws : undefined;
  } catch {
    return undefined;
  }
}

export async function companyServersForUser(workspace: Workspace | undefined, user: PersonalUser) {
  const servers = workspace?.companyServers ?? [];
  if (!workspace || !servers.length || !signingSecretFor(workspace)) return [];
  const defs: McpServerDef[] = [];
  for (const s of servers) {
    defs.push({
      name: s.name,
      type: "http",
      url: s.url,
      headers: { Authorization: `Bearer ${await createCompanyUserToken(workspace, user, s.name)}` },
    });
  }
  return defs;
}

// ---------- Users created through the API ----------

export function isValidExternalId(id: string) {
  return EXTERNAL_ID.test(id);
}

export function apiUserId(workspaceId: string, externalId: string) {
  return `api:${workspaceId}:${externalId}`;
}

export async function getApiUser(workspace: Workspace, externalId: string) {
  if (!isValidExternalId(externalId)) return undefined;
  const store = await getStore();
  const user = store.users[apiUserId(workspace.id, externalId)];
  return user && user.workspaceId === workspace.id ? publicUser(user) : undefined;
}

export async function upsertApiUser(
  workspace: Workspace,
  externalId: string,
  input: { name?: string; email?: string },
) {
  if (!isValidExternalId(externalId)) return undefined;
  const id = apiUserId(workspace.id, externalId);
  const now = new Date().toISOString();
  const name = input.name?.trim().slice(0, 80) || undefined;
  const email = input.email?.trim().toLowerCase().slice(0, 200) || undefined;
  const result = await updateStore((store) => {
    const existing = store.users[id];
    if (existing) {
      if (existing.workspaceId !== workspace.id) return undefined;
      Object.assign(existing, {
        displayName: name ?? existing.displayName,
        email: email ?? existing.email,
        membershipStatus: "active",
        updatedAt: now,
        lastSeenAt: now,
      });
      return { user: publicUser(existing), created: false };
    }
    const user: PersonalUser = {
      id,
      externalId,
      displayName: name,
      email,
      workspaceId: workspace.id,
      role: "client",
      membershipStatus: "active",
      agentRef: "main",
      enabledSkillIds: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    store.users[id] = user;
    return { user: publicUser(user), created: true };
  });
  if (result?.created) {
    await appendAudit({ ownerUserId: id, type: "api_user.create", detail: `Created by ${workspace.slug} API` });
  }
  return result;
}

export async function deactivateApiUser(workspace: Workspace, externalId: string) {
  if (!isValidExternalId(externalId)) return false;
  const id = apiUserId(workspace.id, externalId);
  return updateStore((store) => {
    const user = store.users[id];
    if (!user || user.workspaceId !== workspace.id) return false;
    user.membershipStatus = "suspended";
    user.updatedAt = new Date().toISOString();
    return true;
  });
}
