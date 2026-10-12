import type { ToolKind, TraceEvent, TraceTool } from "@/lib/trace-types";

export type RawSseEvent = { id?: string; event: string; data: string };

/** Incrementally parses a text/event-stream body into events. */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<RawSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseBlock(block);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
    const tail = parseBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): RawSseEvent | undefined {
  let id: string | undefined;
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (!data.length && event === "message") return undefined;
  return { id, event, data: data.join("\n") };
}

const MAX_STRING = 4000;
const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(?:xox[abpr]|gh[pousr]|github_pat|crsr|sk|key)_[A-Za-z0-9_-]{16,}/g,
  /(PA_VAULT_JOB_TOKEN\s*[=:]\s*)\S+/g,
  /(Bearer\s+)[A-Za-z0-9._-]{16,}/g,
];

function scrubString(value: string) {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" && match.startsWith(prefix)
        ? `${prefix}[redacted]`
        : "[redacted]",
    );
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}… [${out.length - MAX_STRING} more chars]` : out;
}

/** Deep-copies a JSON value, redacting token-like strings and capping sizes. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[…]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = /secret|password|token|authorization/i.test(key) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

const VAULT_SAFE_KEYS = new Set([
  "handle",
  "url",
  "origin",
  "method",
  "label",
  "filled_fields",
  "success",
  "status",
  "error",
  "toolName",
  "server",
  "serverName",
  "name",
]);

function pickSafe(value: unknown, depth = 0): unknown {
  if (depth > 4 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return value.map((v) => pickSafe(v, depth + 1)).filter((v) => v !== undefined);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (VAULT_SAFE_KEYS.has(key) && (typeof v !== "object" || v === null)) out[key] = scrub(v);
    else if (v && typeof v === "object") {
      const nested = pickSafe(v, depth + 1);
      if (nested && Object.keys(nested).length) out[key] = nested;
    }
  }
  return out;
}

function findString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 5 || !value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  for (const v of Object.values(record)) {
    const found = findString(v, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function findNumber(value: unknown, keys: string[], depth = 0): number | undefined {
  if (depth > 5 || !value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "number") return record[key] as number;
  }
  for (const v of Object.values(record)) {
    const found = findNumber(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function classifyTool(name: string, args: unknown): ToolKind {
  const n = name.toLowerCase();
  const argText = JSON.stringify(args ?? "").toLowerCase();
  if (/vault_(fill|http|list)|personal-vault/.test(argText) || n.startsWith("vault_")) return "vault";
  if (/terminal|shell|bash|command/.test(n)) return "terminal";
  if (/browser|computer|screenshot|playwright|navigate|click/.test(n)) return "browser";
  if (n === "mcp" && /playwright|browser|puppeteer/.test(argText)) return "browser";
  if (n === "mcp") return "mcp";
  if (/search|grep|glob|web_fetch|fetch/.test(n)) return "search";
  if (/file|read|write|edit|replace|list_dir|delete|apply_patch/.test(n)) return "file";
  return "other";
}

function fileAction(name: string) {
  const n = name.toLowerCase();
  if (/delete/.test(n)) return "Deleted";
  if (/write|edit|replace|patch|create/.test(n)) return "Edited";
  if (/list_dir/.test(n)) return "Listed";
  return "Read";
}

function toolTitle(tool: Omit<TraceTool, "title">): string {
  const args = tool.args;
  switch (tool.kind) {
    case "terminal":
      return tool.terminal?.command || "Ran a command";
    case "file":
      return tool.file ? `${tool.file.action} ${tool.file.path}` : tool.name;
    case "browser": {
      const url = findString(args, ["url"]);
      const action = findString(args, ["action", "toolName"]);
      return [action || "Browser", url].filter(Boolean).join(" · ");
    }
    case "search":
      return `Searched ${findString(args, ["query", "pattern", "search_term", "url"]) || ""}`.trim();
    case "vault": {
      const toolName = findString(args, ["toolName", "name"]) || "vault";
      const url = findString(args, ["url", "origin"]);
      return [toolName, url].filter(Boolean).join(" · ");
    }
    case "mcp": {
      const server = findString(args, ["server", "serverName"]);
      const toolName = findString(args, ["toolName", "name"]);
      return [server, toolName].filter(Boolean).join(" · ") || "MCP tool";
    }
    default:
      return tool.name;
  }
}

/** Builds the browser-safe tool event. Vault tools only keep allow-listed metadata. */
export function normalizeToolCall(raw: {
  callId: string;
  name: string;
  status: string;
  args?: unknown;
  result?: unknown;
  truncated?: { args?: true; result?: true };
}): TraceTool {
  const kind = classifyTool(raw.name, raw.args);
  const isVault = kind === "vault";
  const args = isVault ? pickSafe(raw.args) : scrub(raw.args);
  const result = isVault ? pickSafe(raw.result) : scrub(raw.result);
  const status = raw.status === "completed" ? "completed" : "running";

  const base: Omit<TraceTool, "title"> = {
    callId: raw.callId,
    name: raw.name,
    kind,
    status,
    args,
    result,
    truncated: raw.truncated,
  };

  if (kind === "terminal") {
    const command = findString(raw.args, ["command", "cmd"]) || "";
    const output = raw.result === undefined
      ? undefined
      : typeof raw.result === "string"
        ? raw.result
        : findString(raw.result, ["output", "stdout", "content", "text", "stderr"]);
    base.terminal = {
      command: scrubString(command),
      output: output === undefined ? undefined : scrubString(output),
      exitCode: findNumber(raw.result, ["exitCode", "exit_code", "code"]),
    };
  }
  if (kind === "file") {
    const path = findString(raw.args, ["path", "target_file", "file_path", "relative_workspace_path", "target_directory"]);
    if (path) base.file = { path, action: fileAction(raw.name) };
  }

  return { ...base, title: toolTitle(base) };
}

/** Maps one Cursor run-stream event to our wire format (or nothing). */
export function toTraceEvent(raw: RawSseEvent): TraceEvent | undefined {
  let data: Record<string, unknown> = {};
  try {
    data = raw.data ? (JSON.parse(raw.data) as Record<string, unknown>) : {};
  } catch {
    return undefined;
  }
  switch (raw.event) {
    case "status":
      return { type: "status", status: String(data.status ?? "") };
    case "thinking":
      return { type: "thinking", text: scrubString(String(data.text ?? "")) };
    case "assistant":
      return { type: "assistant", text: scrubString(String(data.text ?? "")) };
    case "tool_call":
      return {
        type: "tool",
        ...normalizeToolCall(data as Parameters<typeof normalizeToolCall>[0]),
      };
    case "result":
      return {
        type: "result",
        status: String(data.status ?? ""),
        text: typeof data.text === "string" ? scrubString(data.text) : undefined,
        durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
      };
    case "error":
      return { type: "error", message: String(data.message ?? data.code ?? "Stream error") };
    case "done":
      return { type: "done" };
    default:
      return undefined;
  }
}

export function encodeSse(event: TraceEvent, id?: string) {
  return `${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(event)}\n\n`;
}
