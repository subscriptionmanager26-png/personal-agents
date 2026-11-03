import { decryptSecret, encryptSecret, randomId } from "@/lib/crypto";
import type { McpTool, ToolResult } from "@/lib/mcp-server";
import { getStoreFresh, updateStore } from "@/lib/store";
import {
  dualWriteRelationalEnabled,
  readUserConnections,
  writeUserConnections,
} from "@/lib/store-relational";
import type { McpConnection } from "@/lib/types";
import { appendAudit } from "@/lib/users";

/**
 * Zerodha's hosted Kite MCP server. It ties a Kite login to the MCP session id, so we keep one
 * session per client here (encrypted) instead of letting each agent run open a new, logged-out one.
 */

export const KITE_MCP_NAME = "zerodha";
const PURPOSE = "kite-mcp-session";
const PROTOCOL = "2025-03-26";
/** Kite expires sessions 12 hours after they open; start a fresh one a little earlier. */
const SESSION_MAX_MS = 11 * 3600_000;
const LOGIN_HOSTS = new Set([
  "kite.zerodha.com",
  "kite.trade",
  "mcp.kite.trade",
  "www.kite.trade",
]);

/** Tools that place, change or cancel orders. Trades go through propose_order and the client's confirmation. */
export const KITE_BLOCKED_TOOLS = new Set([
  "place_order",
  "modify_order",
  "cancel_order",
  "place_gtt_order",
  "modify_gtt_order",
  "delete_gtt_order",
]);

function kiteUrl() {
  return process.env.KITE_MCP_URL?.trim() || "https://mcp.kite.trade/mcp";
}

type RpcReply = { result?: unknown; error?: { code: number; message: string } };

/** Default tool calls. Login/session open use a shorter budget so BFF does not abort first. */
const POST_MS = 30_000;
const SESSION_POST_MS = 12_000;

async function post(
  sessionId: string | undefined,
  payload: Record<string, unknown>,
  timeoutMs = POST_MS,
) {
  const t0 = Date.now();
  const res = await fetch(kiteUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": PROTOCOL,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter(Boolean)
        .pop()
    : text;
  let body: RpcReply | undefined;
  try {
    body = json ? (JSON.parse(json) as RpcReply) : undefined;
  } catch {
    body = undefined;
  }
  const method = typeof payload.method === "string" ? payload.method : "rpc";
  console.info("[kite] rpc", { method, status: res.status, ms: Date.now() - t0, hasSession: Boolean(sessionId) });
  return { status: res.status, body, sessionId: res.headers.get("mcp-session-id") ?? undefined };
}

async function openSession() {
  const init = await post(
    undefined,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "personal-agents", version: "1.0.0" },
      },
    },
    SESSION_POST_MS,
  );
  if (init.status !== 200 || !init.sessionId) {
    throw new Error(`Zerodha is not reachable right now (HTTP ${init.status}).`);
  }
// Must complete before tools/call — login URL includes a server-signed session_id.
  await post(
    init.sessionId,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    SESSION_POST_MS,
  ).catch(() => undefined);
  return init.sessionId;
}

function findKite(list: McpConnection[] | undefined, ownerUserId: string) {
  return list?.find((c) => c.builtin === "kite" && c.ownerUserId === ownerUserId);
}

async function listConnections(ownerUserId: string): Promise<McpConnection[]> {
  if (dualWriteRelationalEnabled()) {
    try {
      const rows = await readUserConnections(ownerUserId);
      if (rows) return rows;
    } catch (error) {
      console.error("[kite] light connection read failed; falling back to store", error);
    }
  }
  const store = await getStoreFresh();
  return store.connections[ownerUserId] ?? [];
}

async function saveConnections(ownerUserId: string, connections: McpConnection[]) {
  if (dualWriteRelationalEnabled()) {
    try {
      await writeUserConnections(ownerUserId, connections);
      return;
    } catch (error) {
      console.error("[kite] light connection write failed; falling back to updateStore", error);
    }
  }
  await updateStore((store) => {
    store.connections[ownerUserId] = connections;
  });
}

export async function getKiteConnection(ownerUserId: string) {
  return findKite(await listConnections(ownerUserId), ownerUserId);
}

export async function connectKite(ownerUserId: string) {
  const list = await listConnections(ownerUserId);
  if (findKite(list, ownerUserId)) return;
  list.push({
    id: randomId("conn"),
    ownerUserId,
    name: KITE_MCP_NAME,
    url: kiteUrl(),
    builtin: "kite",
    createdAt: new Date().toISOString(),
  });
  await saveConnections(ownerUserId, list);
  await appendAudit({ ownerUserId, type: "connection.add", detail: "Connected Zerodha (Kite MCP)" });
}

export async function disconnectKite(ownerUserId: string) {
  const conn = await getKiteConnection(ownerUserId);
  if (!conn) return;
  if (conn.sessionEnc) {
    // Ends the Kite session on Zerodha's side too; best-effort.
    await fetch(kiteUrl(), {
      method: "DELETE",
      headers: { "Mcp-Session-Id": decryptSecret(conn.sessionEnc, PURPOSE, ownerUserId) },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  const next = (await listConnections(ownerUserId)).filter((c) => c.id !== conn.id);
  await saveConnections(ownerUserId, next);
  await appendAudit({ ownerUserId, type: "connection.delete", detail: "Disconnected Zerodha (Kite MCP)" });
}

async function sessionFor(ownerUserId: string, fresh: boolean) {
  const conn = await getKiteConnection(ownerUserId);
  if (!conn) throw new Error("Zerodha is not connected.");
  const age = conn.sessionStartedAt ? Date.now() - Date.parse(conn.sessionStartedAt) : Infinity;
  if (!fresh && conn.sessionEnc && age < SESSION_MAX_MS) return decryptSecret(conn.sessionEnc, PURPOSE, ownerUserId);
  const sessionId = await openSession();
  const list = await listConnections(ownerUserId);
  const c = findKite(list, ownerUserId);
  if (!c) throw new Error("Zerodha is not connected.");
  c.sessionEnc = encryptSecret(sessionId, PURPOSE, ownerUserId);
  c.sessionStartedAt = new Date().toISOString();
  await saveConnections(ownerUserId, list);
  return sessionId;
}

/**
 * One JSON-RPC call on the client's Kite session.
 * Reuse the stored session by default. Only mint a fresh session when `preferFresh`
 * (login) — auto-retrying with a new session overwrites the OAuth-bound id and
 * leaves later tools like get_holdings on a logged-out session.
 */
async function kiteRequest(
  ownerUserId: string,
  method: string,
  params?: Record<string, unknown>,
  opts?: { preferFresh?: boolean; timeoutMs?: number },
) {
  const sessionId = await sessionFor(ownerUserId, Boolean(opts?.preferFresh));
  const res = await post(
    sessionId,
    { jsonrpc: "2.0", id: 1, method, params },
    opts?.timeoutMs ?? POST_MS,
  );
  if (res.status >= 200 && res.status < 300 && res.body) {
    if (res.body.error) throw new Error(`Zerodha: ${res.body.error.message}`);
    return res.body.result;
  }
  throw new Error(`Zerodha request failed (HTTP ${res.status}).`);
}

export async function kiteTools(ownerUserId: string) {
  const result = (await kiteRequest(ownerUserId, "tools/list")) as { tools?: McpTool[] } | undefined;
  return (result?.tools ?? []).filter((t) => !KITE_BLOCKED_TOOLS.has(t.name));
}

export async function kiteCall(ownerUserId: string, name: string, args: Record<string, unknown> = {}) {
  return ((await kiteRequest(ownerUserId, "tools/call", { name, arguments: args })) ?? { content: [] }) as ToolResult;
}

export function toolResultText(result: ToolResult) {
  return (result.content ?? []).map((c) => c.text ?? "").join("\n");
}

function safeKiteLoginUrl(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && LOGIN_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Extract a Kite authorize / login URL from MCP login tool text. */
function extractKiteLoginUrl(text: string): string | undefined {
  const candidates = [
    text.match(/\]\((https:\/\/mcp\.kite\.trade\/authorize[^)\s]*)\)/i)?.[1],
    text.match(/https:\/\/mcp\.kite\.trade\/authorize[^\s)\]"'<>]+/i)?.[0],
    text.match(/\]\((https:[^)\s]+)\)/)?.[1],
    text.match(/https:\/\/[^\s)\]"'<>]+/i)?.[0],
  ];
  for (const raw of candidates) {
    const cleaned = raw?.replace(/[.,;]+$/, "");
    const url = safeKiteLoginUrl(cleaned);
    if (url) return url;
  }
  return undefined;
}

/** Zerodha's login link for this client's session, or who is already logged in. */
export async function kiteLogin(ownerUserId: string): Promise<{ loggedInAs: string } | { url: string }> {
  const t0 = Date.now();
  // Must call the hosted `login` tool — it returns a signed session_id in redirect_params
  // (`uuid|ts.sig`). Hand-building from the raw MCP session id fails at callback with
  // "missing MCP session_id or Kite request_token".
  const raw = await kiteRequest(
    ownerUserId,
    "tools/call",
    { name: "login", arguments: {} },
    { preferFresh: true, timeoutMs: SESSION_POST_MS },
  );
  const result = (raw ?? { content: [] }) as ToolResult;
  const text = toolResultText(result);
  console.info("[kite] login", { ownerUserId, ms: Date.now() - t0, isError: result.isError });
  const already = text.match(/already logged in as (.+)$/im);
  if (already) return { loggedInAs: already[1].trim() };
  const url = extractKiteLoginUrl(text);
  if (!url) {
    console.error("[kite] login tool returned no usable URL", {
      isError: result.isError,
      preview: text.slice(0, 240),
    });
    throw new Error("Zerodha did not return a login link. Try again in a minute.");
  }
  return { url };
}

/** The logged-in Zerodha user's name, or undefined when the client still has to log in. */
export async function kiteLoggedInAs(ownerUserId: string) {
  const result = await kiteCall(ownerUserId, "get_profile");
  if (result.isError) return undefined;
  const text = toolResultText(result);
  try {
    const profile = JSON.parse(text) as { user_name?: string; user_shortname?: string; user_id?: string };
    return profile.user_name || profile.user_shortname || profile.user_id || "your account";
  } catch {
    return "your account";
  }
}

const NEEDS_LOGIN =
  /log ?in first|login required|not logged in|session (has )?expired|invalid (access )?token|failed to execute\s+get_/i;

export type KiteHoldingDraft = {
  ticker: string;
  qty: number;
  avg?: number;
  name?: string;
};

function parseHoldingsJson(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const rowsRaw = obj.data ?? obj.holdings ?? obj.result;
  return Array.isArray(rowsRaw) ? (rowsRaw as Record<string, unknown>[]) : [];
}

function draftFromKiteRow(raw: Record<string, unknown>): KiteHoldingDraft | null {
  const ticker = String(raw.tradingsymbol ?? raw.trading_symbol ?? raw.symbol ?? raw.ticker ?? "")
    .trim()
    .toUpperCase();
  // Kite net qty can include t1; prefer quantity, fall back to realised+t1.
  const qty = Number(
    raw.quantity ??
      raw.qty ??
      (Number(raw.realised_quantity ?? 0) + Number(raw.t1_quantity ?? 0) || 0),
  );
  if (!ticker || !Number.isFinite(qty) || qty <= 0) return null;
  const avg = Number(raw.average_price ?? raw.average ?? raw.avg ?? raw.avgPrice);
  const name = typeof raw.name === "string" ? raw.name.trim() : undefined;
  const draft: KiteHoldingDraft = { ticker, qty };
  if (Number.isFinite(avg) && avg > 0) draft.avg = avg;
  if (name) draft.name = name;
  return draft;
}

/**
 * Pull equity holdings via the client's Kite MCP session (same connection as Connect Zerodha).
 * Omits pagination args so Kite returns the full list in one call.
 */
export async function kiteHoldings(
  ownerUserId: string,
): Promise<{ holdings: KiteHoldingDraft[] } | { needsLogin: true; message: string }> {
  if (!(await getKiteConnection(ownerUserId))) {
    throw new Error("Zerodha is not connected.");
  }
  const t0 = Date.now();
  // Empty args → full holdings array (limit would wrap pagination metadata).
  const result = await kiteCall(ownerUserId, "get_holdings", {});
  const text = toolResultText(result);
  if (result.isError || NEEDS_LOGIN.test(text)) {
    console.info("[kite] holdings need login", {
      ownerUserId,
      ms: Date.now() - t0,
      preview: text.slice(0, 160),
    });
    return {
      needsLogin: true,
      message: "Your Zerodha session expired. Log in again, then fetch holdings.",
    };
  }
  const byTicker = new Map<string, KiteHoldingDraft>();
  for (const raw of parseHoldingsJson(text)) {
    if (!raw || typeof raw !== "object") continue;
    const draft = draftFromKiteRow(raw);
    if (!draft) continue;
    byTicker.set(draft.ticker, draft);
  }
  const holdings = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  console.info("[kite] holdings", { ownerUserId, ms: Date.now() - t0, count: holdings.length });
  return { holdings };
}
