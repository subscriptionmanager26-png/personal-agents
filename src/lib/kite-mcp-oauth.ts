import crypto from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getConfig } from "@/lib/config";
import { getSupabaseAdmin, supabaseStoreConfigured } from "@/lib/supabase-admin";

const TABLE = "personal_agents_store";
const CONFIG_ROW = "pa:config:kite-mcp-oauth";
const PURPOSE = "kite-mcp-oauth";
const AUTHORITY = "https://mcp.kite.trade";
const MCP_RESOURCE = "https://mcp.kite.trade/mcp";

type StoredKiteMcpOAuth = {
  kind: "kite_mcp_oauth";
  clientId?: string;
  /** Fingerprint of redirect_uris used at registration time. */
  registeredRedirectUris?: string;
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  /** Epoch ms when access token expires (Kite MCP bearer ~24h). */
  expiresAt?: number;
  pending?: { state: string; codeVerifier: string; at: number; redirectUri: string };
};

function trimUrl(base: string) {
  return base.replace(/\/$/, "");
}

const POCKETEDGE_CALLBACK_PATH = "/api/agent/kite-mcp/oauth-callback";

function addPocketedgeCallbackOrigin(uris: Set<string>, origin: string) {
  const base = trimUrl(origin);
  if (!base.startsWith("http")) return;
  uris.add(`${base}${POCKETEDGE_CALLBACK_PATH}`);
  try {
    const u = new URL(base);
    const host = u.hostname;
    if (host.startsWith("www.")) {
      uris.add(`${u.protocol}//${host.slice(4)}${POCKETEDGE_CALLBACK_PATH}`);
    } else if (!host.includes("localhost")) {
      uris.add(`${u.protocol}//www.${host}${POCKETEDGE_CALLBACK_PATH}`);
    }
  } catch {
    // ignore
  }
}

/** All allowed OAuth redirect URIs (register + token exchange must match). */
export function kiteMcpRedirectUris(extra?: string[]): string[] {
  const uris = new Set<string>();
  const publicUrl = getConfig().publicUrl;
  if (publicUrl) uris.add(`${trimUrl(publicUrl)}/api/admin/kite-mcp/oauth/callback`);
  const pocketedge =
    process.env.POCKETEDGE_PUBLIC_URL?.trim() ||
    process.env.POCKETEDGE_SITE_URL?.trim() ||
    "https://www.pocketedge.in";
  if (pocketedge) addPocketedgeCallbackOrigin(uris, pocketedge);
  const more = process.env.KITE_MCP_EXTRA_REDIRECT_URIS?.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (more?.length) for (const u of more) uris.add(trimUrl(u));
  if (extra?.length) {
    for (const u of extra) {
      const t = u?.trim();
      if (t?.startsWith("http")) uris.add(trimUrl(t));
    }
  }
  return [...uris];
}

export function publicRedirectUri() {
  const list = kiteMcpRedirectUris();
  if (!list.length) throw new Error("PUBLIC_URL or POCKETEDGE_PUBLIC_URL is not set.");
  return list[0];
}

function pickRedirectUri(preferred: string | undefined, registered: string[]) {
  if (preferred?.startsWith("http")) {
    const base = trimUrl(preferred);
    if (registered.includes(base)) return base;
    if (base.endsWith(POCKETEDGE_CALLBACK_PATH)) return base;
  }
  return registered[0] ?? publicRedirectUri();
}

function pkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

async function readRow(): Promise<StoredKiteMcpOAuth | null> {
  if (!supabaseStoreConfigured()) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(TABLE).select("data").eq("id", CONFIG_ROW).maybeSingle();
  if (error) throw error;
  const row = data?.data as StoredKiteMcpOAuth | undefined;
  return row?.kind === "kite_mcp_oauth" ? row : null;
}

async function writeRow(row: StoredKiteMcpOAuth) {
  if (!supabaseStoreConfigured()) {
    throw new Error("Supabase store is required for Kite MCP OAuth.");
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from(TABLE).upsert({
    id: CONFIG_ROW,
    data: row,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function clientId(extraRedirect?: string): Promise<string> {
  const env = process.env.KITE_MCP_OAUTH_CLIENT_ID?.trim();
  if (env) return env;
  const redirectUris = kiteMcpRedirectUris(extraRedirect ? [extraRedirect] : undefined);
  const redirectKey = redirectUris.slice().sort().join("|");
  const row = await readRow();
  if (row?.clientId && row.registeredRedirectUris === redirectKey) return row.clientId;
  const res = await fetch(`${AUTHORITY}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Pocketedge Personal Agents",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { client_id?: string; error?: string };
  if (!res.ok || !body.client_id) {
    throw new Error(body.error || `Kite MCP client registration failed (HTTP ${res.status}).`);
  }
  await writeRow({
    kind: "kite_mcp_oauth",
    clientId: body.client_id,
    registeredRedirectUris: redirectKey,
    ...(row?.accessTokenEnc ? { accessTokenEnc: row.accessTokenEnc, expiresAt: row.expiresAt } : {}),
    ...(row?.refreshTokenEnc ? { refreshTokenEnc: row.refreshTokenEnc } : {}),
  });
  console.info("[kite-mcp-oauth] registered client", { redirectUris });
  return body.client_id;
}

async function refreshKiteMcpAccessToken(): Promise<string | undefined> {
  const row = await readRow();
  if (!row?.refreshTokenEnc || !row.clientId) return undefined;
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.refreshTokenEnc, PURPOSE, "global");
  } catch {
    return undefined;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: row.clientId,
    refresh_token: refreshToken,
    resource: MCP_RESOURCE,
  });
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    console.error("[kite-mcp-oauth] refresh failed", json.error || res.status);
    return undefined;
  }
  const expiresIn = Number(json.expires_in);
  const expiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 23 * 3600_000);
  await writeRow({
    kind: "kite_mcp_oauth",
    clientId: row.clientId,
    accessTokenEnc: encryptSecret(json.access_token, PURPOSE, "global"),
    refreshTokenEnc: json.refresh_token
      ? encryptSecret(json.refresh_token, PURPOSE, "global")
      : row.refreshTokenEnc,
    expiresAt,
  });
  console.info("[kite-mcp-oauth] refreshed access token", { expiresAt: new Date(expiresAt).toISOString() });
  return json.access_token;
}

/** Bearer for every JSON-RPC call to hosted mcp.kite.trade (required since Nov 2025). */
export async function kiteMcpBearer(): Promise<string | undefined> {
  const env = process.env.KITE_MCP_BEARER?.trim();
  if (env) return env;

  const row = await readRow();
  if (row?.accessTokenEnc && row.expiresAt && row.expiresAt > Date.now() + 60_000) {
    try {
      return decryptSecret(row.accessTokenEnc, PURPOSE, "global");
    } catch (error) {
      console.error("[kite-mcp-oauth] decrypt failed", error);
    }
  }
  if (row?.refreshTokenEnc) {
    return refreshKiteMcpAccessToken();
  }
  return undefined;
}

export function kiteMcpOAuthConfigured() {
  return Boolean(process.env.KITE_MCP_BEARER?.trim()) || supabaseStoreConfigured();
}

export async function beginKiteMcpOAuth(opts?: { redirectUri?: string }): Promise<{ url: string }> {
  const preferred = opts?.redirectUri?.trim();
  const id = await clientId(preferred);
  const registered = kiteMcpRedirectUris(preferred ? [preferred] : undefined);
  const redirectUri = pickRedirectUri(preferred, registered);
  const { codeVerifier, codeChallenge } = pkcePair();
  const state = crypto.randomBytes(16).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "default",
    resource: MCP_RESOURCE,
  });
  const row = (await readRow()) ?? { kind: "kite_mcp_oauth" as const };
  await writeRow({
    ...row,
    kind: "kite_mcp_oauth",
    clientId: id,
    pending: { state, codeVerifier, at: Date.now(), redirectUri },
  });
  return { url: `${AUTHORITY}/authorize?${params.toString()}` };
}

export async function completeKiteMcpOAuth(input: { code: string; state: string }) {
  const row = await readRow();
  const pending = row?.pending;
  if (!pending || pending.state !== input.state) {
    throw new Error("OAuth state mismatch — start login again.");
  }
  if (Date.now() - pending.at > 15 * 60_000) {
    throw new Error("OAuth session expired — start login again.");
  }
  const id = row?.clientId || (await clientId());
  const redirectUri = pending.redirectUri || publicRedirectUri();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: id,
    code: input.code,
    redirect_uri: redirectUri,
    code_verifier: pending.codeVerifier,
    resource: MCP_RESOURCE,
  });
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`Kite MCP token exchange failed: ${detail}`);
  }
  const expiresIn = Number(json.expires_in);
  const expiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 23 * 3600_000);
  await writeRow({
    ...row,
    kind: "kite_mcp_oauth",
    clientId: id,
    accessTokenEnc: encryptSecret(json.access_token, PURPOSE, "global"),
    refreshTokenEnc: json.refresh_token
      ? encryptSecret(json.refresh_token, PURPOSE, "global")
      : row?.refreshTokenEnc,
    expiresAt,
    pending: undefined,
  });
  console.info("[kite-mcp-oauth] access token stored", {
    expiresAt: new Date(expiresAt).toISOString(),
    hasRefresh: Boolean(json.refresh_token),
  });
}

/** Proactive refresh before access token expires (cron). */
export async function ensureKiteMcpBearerFresh(): Promise<boolean> {
  if (process.env.KITE_MCP_BEARER?.trim()) return true;
  const row = await readRow();
  if (!row) return false;
  const stillValid = row.expiresAt && row.expiresAt > Date.now() + 4 * 3600_000;
  if (stillValid && row.accessTokenEnc) {
    try {
      decryptSecret(row.accessTokenEnc, PURPOSE, "global");
      return true;
    } catch {
      // refresh below
    }
  }
  if (row.refreshTokenEnc) {
    return Boolean(await refreshKiteMcpAccessToken());
  }
  return Boolean(await kiteMcpBearer());
}

export async function kiteMcpAuthErrorMessage() {
  if (await kiteMcpBearer()) return undefined;
  try {
    kiteMcpRedirectUris();
  } catch {
    return "Zerodha MCP OAuth is not configured (missing PUBLIC_URL / POCKETEDGE_PUBLIC_URL).";
  }
  return "Authorize the Kite server once on Connections, then use Connect Zerodha.";
}