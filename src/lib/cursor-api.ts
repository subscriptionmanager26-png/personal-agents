const API = "https://api.cursor.com";

/** Every call takes the workspace's key explicitly (see `runtimeFor`), never a global one. */
export async function cursorPost<T>(
  token: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: T | unknown }> {
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

export async function cursorGet<T>(token: string, path: string): Promise<T> {
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

export async function getAgentConversation(token: string, agentId: string) {
  return cursorGet<{
    messages?: { id?: string; type?: string; text?: string; role?: string }[];
  }>(token, `/v0/agents/${agentId}/conversation`);
}

export async function getAgent(token: string, agentId: string) {
  return cursorGet<{ id?: string; status?: string }>(token, `/v0/agents/${agentId}`);
}

export type CursorRun = {
  id: string;
  agentId: string;
  status: string;
  result?: string;
  durationMs?: number;
};

export const TERMINAL_RUN_STATUSES = [
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
  "COMPLETE",
  "FAILED",
  "SUCCEEDED",
  "SUCCESS",
  "STOPPED",
];

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

export async function getAgentV1(token: string, agentId: string) {
  return cursorGet<{ id: string; status?: string; latestRunId?: string; url?: string }>(
    token,
    `/v1/agents/${agentId}`,
  );
}

export async function getRun(token: string, agentId: string, runId: string) {
  return cursorGet<CursorRun>(token, `/v1/agents/${agentId}/runs/${runId}`);
}

export type McpServerDef =
  | { name: string; type: "http" | "sse"; url: string; headers?: Record<string, string> }
  | { name: string; type: "stdio"; command: string; args?: string[]; env?: Record<string, string> };

/** Follow-up run; `mcpServers` replaces the create-time servers for this run. */
export async function createRun(token: string, agentId: string, promptText: string, mcpServers?: McpServerDef[]) {
  return cursorPost<{ run?: CursorRun }>(token, `/v1/agents/${agentId}/runs`, {
    prompt: { text: promptText },
    ...(mcpServers ? { mcpServers } : {}),
  });
}

export function extractSteerRunId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.runId === "string" && record.runId.trim()) return record.runId.trim();
  return extractRunId(body);
}

export async function cancelRun(token: string, agentId: string, runId: string) {
  return cursorPost(token, `/v1/agents/${agentId}/runs/${runId}/cancel`, {});
}

const ACTIVE_AGENT = new Set(["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK", "ACTIVE"]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cancel a stuck run, wait, retry createRun, then steer if Cursor still returns 409. */
export async function recoverBusyAgentForNewRun(
  token: string,
  agentId: string,
  promptText: string,
  mcpServers?: McpServerDef[],
): Promise<{ runId: string; status: number; body: unknown; mode: "run" | "steer" } | undefined> {
  try {
    const v1 = await getAgentV1(token, agentId);
    const latestRunId = v1.latestRunId;
    if (latestRunId) {
      try {
        const run = await getRun(token, agentId, latestRunId);
        const st = (run.status || "").toUpperCase();
        if (!TERMINAL_RUN_STATUSES.includes(st)) {
          await cancelRun(token, agentId, latestRunId).catch(() => undefined);
          await sleep(1200);
        }
      } catch {
        await cancelRun(token, agentId, latestRunId).catch(() => undefined);
        await sleep(1200);
      }
    } else if (ACTIVE_AGENT.has((v1.status || "").toUpperCase())) {
      await sleep(1500);
    }
  } catch {
    // continue with retries
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const retry = await createRun(token, agentId, promptText, mcpServers);
    const runId = extractRunId(retry.body);
    if (runId) return { runId, status: retry.status, body: retry.body, mode: "run" };
    if (retry.status !== 409) break;
    await sleep(1500);
  }

  const steer = await cursorPost<{ delivery?: string; runId?: string }>(token, `/v1/agents/${agentId}/runs`, {
    prompt: { text: promptText },
    delivery: "steer",
  });
  if (steer.status === 202 || steer.status === 200) {
    let runId = extractSteerRunId(steer.body);
    if (!runId) {
      try {
        runId = (await getAgentV1(token, agentId)).latestRunId;
      } catch {
        runId = undefined;
      }
    }
    if (runId) return { runId, status: steer.status, body: steer.body, mode: "steer" };
  }

  return undefined;
}

/** Opens the raw Cursor SSE stream for one run. Caller owns the response body. */
export async function openRunStream(
  token: string,
  agentId: string,
  runId: string,
  opts: { lastEventId?: string; signal?: AbortSignal } = {},
) {
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

export async function listArtifacts(token: string, agentId: string) {
  const body = await cursorGet<{ items?: CursorArtifact[] }>(
    token,
    `/v1/agents/${agentId}/artifacts`,
  );
  return body.items ?? [];
}

export async function getArtifactDownloadUrl(token: string, agentId: string, path: string) {
  return cursorGet<{ url: string; expiresAt?: string }>(
    token,
    `/v1/agents/${agentId}/artifacts/download?path=${encodeURIComponent(path)}`,
  );
}
