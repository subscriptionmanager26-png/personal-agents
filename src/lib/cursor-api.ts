import { getConfig } from "@/lib/config";

const API = "https://api.cursor.com";

function apiToken() {
  return getConfig().cursorApiKey;
}

export async function cursorPost<T>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: T | unknown }> {
  const token = apiToken();
  if (!token) throw new Error("Cursor API key is not configured");
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    // keep raw
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

export async function cursorGet<T>(path: string): Promise<T> {
  const token = apiToken();
  if (!token) throw new Error("Cursor API key is not configured");
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Cursor API ${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export function extractAgentId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  for (const key of ["backgroundComposerId", "id", "agentId", "bcId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const id = value.trim();
      if (id.startsWith("bc_")) return `bc-${id.slice(3)}`;
      return id;
    }
  }
  return undefined;
}

export async function getAgentConversation(agentId: string) {
  return cursorGet<{
    messages?: { id?: string; type?: string; text?: string; role?: string }[];
  }>(`/v0/agents/${agentId}/conversation`);
}

export async function getAgent(agentId: string) {
  return cursorGet<{ id?: string; status?: string }>(`/v0/agents/${agentId}`);
}

export type CursorRun = {
  id: string;
  agentId: string;
  status: string;
  result?: string;
  durationMs?: number;
};

export const TERMINAL_RUN_STATUSES = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"];

export function extractRunId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const run = record.run as Record<string, unknown> | undefined;
  if (run && typeof run.id === "string") return run.id;
  const agent = record.agent as Record<string, unknown> | undefined;
  if (agent && typeof agent.latestRunId === "string") return agent.latestRunId;
  if (typeof record.latestRunId === "string") return record.latestRunId;
  return undefined;
}

export async function getAgentV1(agentId: string) {
  return cursorGet<{ id: string; status?: string; latestRunId?: string; url?: string }>(
    `/v1/agents/${agentId}`,
  );
}

export async function getRun(agentId: string, runId: string) {
  return cursorGet<CursorRun>(`/v1/agents/${agentId}/runs/${runId}`);
}

export async function createRun(agentId: string, promptText: string) {
  return cursorPost<{ run?: CursorRun }>(`/v1/agents/${agentId}/runs`, {
    prompt: { text: promptText },
  });
}

/** Opens the raw Cursor SSE stream for one run. Caller owns the response body. */
export async function openRunStream(
  agentId: string,
  runId: string,
  opts: { lastEventId?: string; signal?: AbortSignal } = {},
) {
  const token = apiToken();
  if (!token) throw new Error("Cursor API key is not configured");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "text/event-stream",
  };
  if (opts.lastEventId) headers["Last-Event-ID"] = opts.lastEventId;
  return fetch(`${API}/v1/agents/${agentId}/runs/${runId}/stream`, {
    headers,
    cache: "no-store",
    signal: opts.signal,
  });
}

export type CursorArtifact = { path: string; sizeBytes?: number; updatedAt?: string };

export async function listArtifacts(agentId: string) {
  const body = await cursorGet<{ items?: CursorArtifact[] }>(
    `/v1/agents/${agentId}/artifacts`,
  );
  return body.items ?? [];
}

export async function getArtifactDownloadUrl(agentId: string, path: string) {
  return cursorGet<{ url: string; expiresAt?: string }>(
    `/v1/agents/${agentId}/artifacts/download?path=${encodeURIComponent(path)}`,
  );
}
