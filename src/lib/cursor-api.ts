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
