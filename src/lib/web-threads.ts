import { getStore, updateStore } from "@/lib/store";
import { threadKey } from "@/lib/jobs";
import type { Job, JobSource, StoreData, WebThread } from "@/lib/types";

export function webThreadStoreKey(ownerUserId: string, source: "web" | "api", threadId: string) {
  return threadKey(ownerUserId, source, threadId);
}

export function webThreadSource(jobSource: JobSource): "web" | "api" {
  return jobSource === "api" ? "api" : "web";
}

export function titleFromPrompt(prompt: string) {
  const t = prompt.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  return t.length > 72 ? `${t.slice(0, 72)}…` : t;
}

export async function getWebThread(ownerUserId: string, source: "web" | "api", threadId: string) {
  const store = await getStore();
  const key = webThreadStoreKey(ownerUserId, source, threadId);
  const thread = store.webThreads[key];
  if (!thread || thread.ownerUserId !== ownerUserId) return undefined;
  return thread;
}

/** Create or touch a web thread when a job is enqueued. */
export async function touchWebThread(input: {
  ownerUserId: string;
  source: "web" | "api";
  threadId: string;
  prompt: string;
}) {
  const now = new Date().toISOString();
  const title = titleFromPrompt(input.prompt);
  return updateStore((store) => {
    const key = webThreadStoreKey(input.ownerUserId, input.source, input.threadId);
    const existing = store.webThreads[key];
    if (existing && existing.ownerUserId === input.ownerUserId) {
      existing.updatedAt = now;
      if (existing.title === "New chat" && title !== "New chat") existing.title = title;
      return existing;
    }
    const thread: WebThread = {
      id: input.threadId,
      ownerUserId: input.ownerUserId,
      source: input.source,
      title,
      createdAt: now,
      updatedAt: now,
    };
    store.webThreads[key] = thread;
    return thread;
  });
}

export async function updateWebThreadAgent(
  ownerUserId: string,
  source: "web" | "api",
  threadId: string,
  cursorAgentId: string,
  cursorAgentSkillsHash: string,
) {
  const now = new Date().toISOString();
  return updateStore((store) => {
    const key = webThreadStoreKey(ownerUserId, source, threadId);
    let thread = store.webThreads[key];
    if (!thread) {
      thread = {
        id: threadId,
        ownerUserId,
        source,
        title: "New chat",
        createdAt: now,
        updatedAt: now,
      };
      store.webThreads[key] = thread;
    }
    thread.cursorAgentId = cursorAgentId;
    thread.cursorAgentSkillsHash = cursorAgentSkillsHash;
    thread.updatedAt = now;
    return thread;
  });
}

export async function updateSlackThreadAgent(
  ownerUserId: string,
  channelId: string,
  threadTs: string,
  cursorAgentId: string,
  cursorAgentSkillsHash: string,
) {
  const now = new Date().toISOString();
  return updateStore((store) => {
    const key = threadKey(ownerUserId, channelId, threadTs);
    const ref = store.slackThreads[key];
    if (!ref || ref.ownerUserId !== ownerUserId) return undefined;
    ref.cursorAgentId = cursorAgentId;
    ref.cursorAgentSkillsHash = cursorAgentSkillsHash;
    ref.updatedAt = now;
    return ref;
  });
}

const ACTIVE = new Set(["queued", "dispatched", "delivering"]);

/** List threads for UI, merged with recent job activity. */
export async function listWebThreadsForUser(
  ownerUserId: string,
  source: "web" | "api",
  jobs: Job[],
  limit = 40,
  storeSnapshot?: StoreData,
): Promise<{ id: string; title: string; updatedAt: string; working: boolean }[]> {
  const store = storeSnapshot ?? await getStore();
  const merged = new Map<string, { id: string; title: string; updatedAt: string; working: boolean }>();

  for (const thread of Object.values(store.webThreads)) {
    if (thread.ownerUserId !== ownerUserId || thread.source !== source) continue;
    merged.set(thread.id, {
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      working: false,
    });
  }

  for (const job of jobs) {
    if (job.ownerUserId !== ownerUserId) continue;
    const jobSource = job.source === "api" ? "api" : job.source === "web" ? "web" : null;
    if (jobSource !== source) continue;
    const id = job.webThreadId ?? "main";
    const at = job.updatedAt || job.createdAt || "";
    const working = ACTIVE.has(job.status);
    const existing = merged.get(id);
    const title = titleFromPrompt(job.prompt);
    if (!existing) {
      merged.set(id, { id, title, updatedAt: at, working });
      continue;
    }
    if (at.localeCompare(existing.updatedAt || "") > 0) {
      existing.updatedAt = at;
      if (title !== "New chat") existing.title = title;
    }
    existing.working ||= working;
  }

  return [...merged.values()]
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);
}
