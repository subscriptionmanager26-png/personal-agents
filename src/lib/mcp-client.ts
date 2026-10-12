/** Minimal stateless MCP-over-HTTP client (JSON responses), used by the local mock agent. */
export async function mcpRequest(url: string, token: string, method: string, params?: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

export async function mcpListTools(url: string, token: string) {
  const result = (await mcpRequest(url, token, "tools/list")) as { tools?: { name: string }[] };
  return (result.tools ?? []).map((t) => t.name);
}

/** Calls a tool and parses its JSON text content; `isError` results come back with `error`. */
export async function mcpCallTool(url: string, token: string, name: string, args: Record<string, unknown> = {}) {
  const result = (await mcpRequest(url, token, "tools/call", { name, arguments: args })) as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = result.content?.find((c) => c.type === "text")?.text ?? "{}";
  try {
    return { data: JSON.parse(text) as Record<string, unknown>, isError: Boolean(result.isError) };
  } catch {
    return { data: { text } as Record<string, unknown>, isError: Boolean(result.isError) };
  }
}
