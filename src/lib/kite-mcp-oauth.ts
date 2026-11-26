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
  accessTokenEnc?: string;
  /** Epoch ms when access token expires (Kite MCP bearer ~24h). */
  expiresAt?: number;
  pending?: { state: string; codeVerifier: string; at: number };
};

function publicRedirectUri() {
  const base = getConfig().publicUrl.replace(/\/$/, "");
  if (!base) throw new Error("PUBLIC_URL is not set.");
  return `${base}/api/admin/kite-mcp/oauth/callback`;
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

async function clientId(): Promise<string> {
  const env = process.env.KITE_MCP_OAUTH_CLIENT_ID?.trim();
  if (env) return env;
  const row = await readRow();
  if (row?.clientId) return row.clientId;
  const redirectUri = publicRedirectUri();
  const res = await fetch(`${AUTHORITY}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Pocketedge Personal Agents",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
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
    ...(row?.accessTokenEnc ? { accessTokenEnc: row.accessTokenEnc, expiresAt: row.expiresAt } : {}),
  });
  console.info("[kite-mcp-oauth] registered client", { redirectUri });
  return body.client_id;
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
  return undefined;
}

export function kiteMcpOAuthConfigured() {
  return Boolean(process.env.KITE_MCP_BEARER?.trim()) || supabaseStoreConfigured();
}

export async function beginKiteMcpOAuth(): Promise<{ url: string }> {
  const id = await clientId();
  const redirectUri = publicRedirectUri();
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
    pending: { state, codeVerifier, at: Date.now() },
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
  const redirectUri = publicRedirectUri();
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
    kind: "kite_mcp_oauth",
    clientId: id,
    accessTokenEnc: encryptSecret(json.access_token, PURPOSE, "global"),
    expiresAt,
  });
  console.info("[kite-mcp-oauth] access token stored", { expiresAt: new Date(expiresAt).toISOString() });
}

export async function kiteMcpAuthErrorMessage() {
  if (await kiteMcpBearer()) return undefined;
  try {
    publicRedirectUri();
  } catch {
    return "Zerodha MCP OAuth is not configured (missing PUBLIC_URL).";
  }
  const base = getConfig().publicUrl.replace(/\/$/, "");
  return (
    "Zerodha’s hosted MCP needs a one-time server authorization (~24h). " +
    "On pocketedge.in → Connections, use “Authorize Zerodha server” (operator PocketEdge login). " +
    (base ? `Callback host: ${base.replace(/^https?:\/\//, "")}.` : "")
  );
}