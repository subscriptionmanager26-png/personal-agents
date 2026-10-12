import { getJob, patchJob } from "@/lib/jobs";
import {
  clampImportance,
  createMemory,
  deleteMemory,
  listMemories,
  MAX_CONTENT,
  MAX_TITLE,
  memoryRejection,
  searchMemories,
  updateMemory,
} from "@/lib/memory";
import { verifyMemoryToken } from "@/lib/run-token";
import type { MemoryEntry } from "@/lib/types";
import { getUser } from "@/lib/users";
import { canUseAgent } from "@/lib/workspaces";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const TOOLS = [
  {
    name: "memory_search",
    description:
      "Search this client's long-term memory. Use it before answering when earlier context might matter. Returns entries with ids.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords; empty returns the most important entries." },
        kind: { type: "string", description: "Only entries of this kind." },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "memory_save",
    description:
      "Store something worth remembering about this client. You choose the kind (e.g. preference, goal, fact, holding, episode) and importance 1-5. Never store credentials.",
    inputSchema: {
      type: "object",
      required: ["title", "content"],
      properties: {
        title: { type: "string", maxLength: MAX_TITLE },
        content: { type: "string", maxLength: MAX_CONTENT },
        kind: { type: "string" },
        importance: { type: "number", minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: "memory_update",
    description: "Revise an existing memory (merge new facts, correct it, change importance).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string", maxLength: MAX_TITLE },
        content: { type: "string", maxLength: MAX_CONTENT },
        kind: { type: "string" },
        importance: { type: "number", minimum: 1, maximum: 5 },
      },
    },
  },
  {
    name: "memory_forget",
    description: "Delete a memory that is wrong, outdated or merged into another.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
];

function view(m: MemoryEntry) {
  return {
    id: m.id,
    kind: m.kind,
    title: m.title,
    content: m.content,
    importance: m.importance,
    updated: m.updatedAt.slice(0, 10),
  };
}

function text(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function str(v: unknown) {
  return typeof v === "string" ? v : undefined;
}

async function callTool(ownerUserId: string, jobId: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "memory_search": {
      const found = await searchMemories(ownerUserId, {
        query: str(args.query),
        kind: str(args.kind),
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return text({ memories: found.map(view) });
    }
    case "memory_save": {
      const title = str(args.title)?.trim() || "";
      const content = str(args.content)?.trim() || "";
      if (!title || !content) return text({ error: "title and content are required" }, true);
      const rejection = memoryRejection(`${title}\n${content}`);
      if (rejection) return text({ error: rejection }, true);
      const saved = await createMemory({
        ownerUserId,
        kind: str(args.kind) || "note",
        title,
        content,
        importance: clampImportance(args.importance ?? 3),
        source: "agent",
        sourceJobId: jobId,
      });
      await countWrite(ownerUserId, jobId);
      return text({ saved: view(saved) });
    }
    case "memory_update": {
      const id = str(args.id);
      if (!id) return text({ error: "id is required" }, true);
      const patch = {
        title: str(args.title),
        content: str(args.content),
        kind: str(args.kind),
        importance: args.importance === undefined ? undefined : clampImportance(args.importance),
      };
      const rejection = memoryRejection(`${patch.title ?? ""}\n${patch.content ?? ""}`);
      if (rejection) return text({ error: rejection }, true);
      const updated = await updateMemory(ownerUserId, id, patch);
      if (!updated) return text({ error: "No memory with that id." }, true);
      await countWrite(ownerUserId, jobId);
      return text({ updated: view(updated) });
    }
    case "memory_forget": {
      const id = str(args.id);
      if (!id) return text({ error: "id is required" }, true);
      const ok = await deleteMemory(ownerUserId, id);
      if (ok) await countWrite(ownerUserId, jobId);
      return text(ok ? { forgotten: id } : { error: "No memory with that id." }, !ok);
    }
    default:
      return undefined;
  }
}

async function countWrite(ownerUserId: string, jobId: string) {
  const job = await getJob(jobId);
  if (!job || job.ownerUserId !== ownerUserId) return;
  await patchJob(jobId, ownerUserId, { memoryWrites: (job.memoryWrites ?? 0) + 1 });
}

/** Resolves the tenant for a bearer token, or undefined when it must be refused. */
export async function authorizeMemoryCaller(bearer: string) {
  let claims;
  try {
    claims = await verifyMemoryToken(bearer);
  } catch {
    return undefined;
  }
  const job = await getJob(claims.jobId);
  if (!job || job.ownerUserId !== claims.ownerUserId || job.status === "error") return undefined;
  const user = await getUser(claims.ownerUserId);
  if (!canUseAgent(user)) return undefined;
  return claims;
}

async function handleOne(
  caller: { ownerUserId: string; jobId: string },
  req: RpcRequest,
): Promise<RpcResponse | undefined> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (req.method) {
    case "initialize": {
      const count = (await listMemories(caller.ownerUserId)).length;
      return ok({
        protocolVersion: typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "personal-memory", version: "1.0.0" },
        instructions: `Long-term memory for this one client (${count} entries). Only this client's memory is reachable.`,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = str(req.params?.name) || "";
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const result = await callTool(caller.ownerUserId, caller.jobId, name, args);
      return result ? ok(result) : fail(-32602, `Unknown tool: ${name}`);
    }
    default:
      if (isNotification) return undefined;
      return fail(-32601, `Method not found: ${req.method}`);
  }
}

/** Streamable-HTTP MCP endpoint body handling (JSON responses, no server-initiated streams). */
export async function handleMemoryRpc(bearer: string, body: unknown) {
  const caller = await authorizeMemoryCaller(bearer);
  if (!caller) return { status: 401, json: { error: "unauthorized" } };
  const requests = Array.isArray(body) ? body : [body];
  const responses: RpcResponse[] = [];
  for (const raw of requests) {
    if (!raw || typeof raw !== "object") {
      responses.push({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
      continue;
    }
    const res = await handleOne(caller, raw as RpcRequest);
    if (res) responses.push(res);
  }
  if (!responses.length) return { status: 202, json: undefined };
  return { status: 200, json: Array.isArray(body) ? responses : responses[0] };
}
