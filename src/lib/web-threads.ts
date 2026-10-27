import { getStore, updateStore } from "@/lib/store";
import { threadKey } from "@/lib/jobs";
import { listWebThreadRows, relationalStoreEnabled, upsertWebThreadRow } from "@/lib/store-relational";
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
  const { getStoreFresh } = await import("@/lib/store");
  const store = await getStoreFresh();
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
      void upsertWebThreadRow(existing).catch(() => undefined);
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
    void upsertWebThreadRow(thread).catch(() => undefined);
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
    void upsertWebThreadRow(thread).catch(() => undefined);
    return thread;
  });
}

const ACTIVE_THREAD = new Set(["queued", "dispatched", "delivering"]);

/** Keep sidebar `working` / `updatedAt` in sync without scanning all jobs on list. */
export function syncWebThreadActivity(store: StoreData, job: Job) {
  if (job.source === "slack") return;
  const source = webThreadSource(job.source ?? "web");
  const threadId = job.webThreadId ?? "main";
  const key = webThreadStoreKey(job.ownerUserId, source, threadId);
  const now = job.updatedAt || job.createdAt || new Date().toISOString();
  let thread = store.webThreads[key];
  if (!thread || thread.ownerUserId !== job.ownerUserId) {
    thread = {
      id: threadId,
      ownerUserId: job.ownerUserId,
      source,
      title: titleFromPrompt(job.prompt),
      createdAt: job.createdAt || now,
      updatedAt: now,
    };
    store.webThreads[key] = thread;
  }
  const peers = (store.jobs ?? []).filter(
    (j) =>
      j.ownerUserId === job.ownerUserId &&
      (j.source ?? "web") === (job.source ?? "web") &&
      (j.webThreadId ?? "main") === threadId,
  );
  thread.working = peers.some((j) => ACTIVE_THREAD.has(j.status));
  if (now.localeCompare(thread.updatedAt || "") >= 0) {
    thread.updatedAt = now;
    const title = titleFromPrompt(job.prompt);
    if (title !== "New chat") thread.title = title;
  }
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
  const merged = new Map<string, { id: string; title: string; updatedAt: string; working: boolean }>();

  if (relationalStoreEnabled() && !storeSnapshot) {
    try {
      const rows = await listWebThreadRows(ownerUserId, source, limit);
      for (const thread of rows) {
        merged.set(thread.id, {
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt,
          working: Boolean(thread.working),
        });
      }
      if (merged.size || jobs.length === 0) {
        return [...merged.values()]
          .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
          .slice(0, limit);
      }
    } catch {
      // fall through to blob
    }
  }

  const store = storeSnapshot ?? await getStore();

  for (const thread of Object.values(store.webThreads)) {
    if (thread.ownerUserId !== ownerUserId || thread.source !== source) continue;
    merged.set(thread.id, {
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      working: Boolean(thread.working),
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
