export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown> };
export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

export function toolText(value: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

export type McpServerSpec = {
  name: string;
  instructions?: () => Promise<string> | string;
  tools: McpTool[];
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult | undefined>;
};

async function handleOne(spec: McpServerSpec, req: RpcRequest): Promise<RpcResponse | undefined> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (req.method) {
    case "initialize":
      return ok({
        protocolVersion: typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: spec.name, version: "1.0.0" },
        ...(spec.instructions ? { instructions: await spec.instructions() } : {}),
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: spec.tools });
    case "tools/call": {
      const name = typeof req.params?.name === "string" ? req.params.name : "";
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const result = await spec.call(name, args);
      return result ? ok(result) : fail(-32602, `Unknown tool: ${name}`);
    }
    default:
      if (isNotification) return undefined;
      return fail(-32601, `Method not found: ${req.method}`);
  }
}

/** Streamable-HTTP MCP request body handling (JSON responses only, stateless). */
export async function handleMcpBody(spec: McpServerSpec, body: unknown) {
  const requests = Array.isArray(body) ? body : [body];
  const responses: RpcResponse[] = [];
  for (const raw of requests) {
    if (!raw || typeof raw !== "object") {
      responses.push({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
      continue;
    }
    const res = await handleOne(spec, raw as RpcRequest);
    if (res) responses.push(res);
  }
  if (!responses.length) return { status: 202, json: undefined };
  return { status: 200, json: Array.isArray(body) ? responses : responses[0] };
}

/** Next route helper: parse JSON, run `handle`, map to a Response. */
export async function mcpRoute(
  request: Request,
  handle: (bearer: string, body: unknown) => Promise<{ status: number; json: unknown }>,
) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const { status, json } = await handle(bearer, body);
  return json === undefined ? new Response(null, { status }) : Response.json(json, { status });
}
