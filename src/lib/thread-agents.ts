import { threadKey } from "@/lib/jobs";
import { getStore, updateStore } from "@/lib/store";
import { upsertWebThreadRow } from "@/lib/store-relational";
import type { Job, PersonalUser } from "@/lib/types";
import {
  getWebThread,
  updateSlackThreadAgent,
  updateWebThreadAgent,
  webThreadSource,
  webThreadStoreKey,
} from "@/lib/web-threads";

export type ThreadAgentBinding = {
  agentId?: string;
  skillsHash?: string;
};

const AGENT_CREATE_LOCK_TTL_MS = 3 * 60_000;

export type ThreadAgentCreateGate =
  | { mode: "reuse"; agentId: string; skillsHash?: string }
  | { mode: "create" }
  | { mode: "wait" };

/**
 * Ensure only one worker calls createAgent for a thread. Others reuse or wait.
 * skillsHash mismatches no longer force a new agent — reuse and refresh hash later.
 */
export async function beginThreadAgentCreate(
  job: Job,
  user: PersonalUser,
): Promise<ThreadAgentCreateGate> {
  if (job.source === "slack" && job.slackChannelId && job.slackThreadTs) {
    const binding = await agentBindingForJob(job, user);
    if (binding.agentId) return { mode: "reuse", agentId: binding.agentId, skillsHash: binding.skillsHash };
    return { mode: "create" };
  }

  const source = webThreadSource(job.source ?? "web");
  const threadId = job.webThreadId ?? "main";
  const key = webThreadStoreKey(job.ownerUserId, source, threadId);
  const now = Date.now();

  return updateStore((store) => {
    let thread = store.webThreads[key];
    if (!thread) {
      const iso = new Date(now).toISOString();
      thread = {
        id: threadId,
        ownerUserId: job.ownerUserId,
        source,
        title: "New chat",
        createdAt: iso,
        updatedAt: iso,
      };
      store.webThreads[key] = thread;
    }
    if (thread.cursorAgentId) {
      return {
        mode: "reuse" as const,
        agentId: thread.cursorAgentId,
        skillsHash: thread.cursorAgentSkillsHash,
      };
    }
    if (thread.agentCreateLockAt) {
      const age = now - Date.parse(thread.agentCreateLockAt);
      if (
        Number.isFinite(age) &&
        age >= 0 &&
        age < AGENT_CREATE_LOCK_TTL_MS &&
        thread.agentCreateLockJobId &&
        thread.agentCreateLockJobId !== job.id
      ) {
        return { mode: "wait" as const };
      }
    }
    thread.agentCreateLockAt = new Date(now).toISOString();
    thread.agentCreateLockJobId = job.id;
    thread.updatedAt = thread.agentCreateLockAt;
    void upsertWebThreadRow(thread).catch(() => undefined);
    return { mode: "create" as const };
  });
}

export async function clearThreadAgentCreateLock(job: Job): Promise<void> {
  if (job.source === "slack") return;
  const source = webThreadSource(job.source ?? "web");
  const threadId = job.webThreadId ?? "main";
  const key = webThreadStoreKey(job.ownerUserId, source, threadId);
  await updateStore((store) => {
    const thread = store.webThreads[key];
    if (!thread) return;
    if (thread.agentCreateLockJobId && thread.agentCreateLockJobId !== job.id) return;
    delete thread.agentCreateLockAt;
    delete thread.agentCreateLockJobId;
    thread.updatedAt = new Date().toISOString();
    void upsertWebThreadRow(thread).catch(() => undefined);
  });
}

/** Poll until another worker finishes createAgent or the lock expires. */
export async function waitForThreadAgent(job: Job, maxWaitMs = 45_000): Promise<ThreadAgentBinding> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const { getUser } = await import("@/lib/users");
    const user = (await getUser(job.ownerUserId)) ?? ({ id: job.ownerUserId } as PersonalUser);
    const binding = await agentBindingForJob(job, user);
    if (binding.agentId) return binding;
    await new Promise((r) => setTimeout(r, 750));
  }
  const { getUser } = await import("@/lib/users");
  const user = (await getUser(job.ownerUserId)) ?? ({ id: job.ownerUserId } as PersonalUser);
  return agentBindingForJob(job, user);
}

/** Cursor agent for this conversation thread (not the user-global legacy field). */
export async function agentBindingForJob(job: Job, user: PersonalUser): Promise<ThreadAgentBinding> {
  if (job.source === "slack" && job.slackChannelId && job.slackThreadTs) {
    const store = await getStore();
    const ref = store.slackThreads[threadKey(job.ownerUserId, job.slackChannelId, job.slackThreadTs)];
    if (!ref || ref.ownerUserId !== job.ownerUserId) return {};
    return { agentId: ref.cursorAgentId, skillsHash: ref.cursorAgentSkillsHash };
  }

  const source = webThreadSource(job.source ?? "web");
  const threadId = job.webThreadId ?? "main";
  const thread = await getWebThread(job.ownerUserId, source, threadId);

  if (thread?.cursorAgentId) {
    return { agentId: thread.cursorAgentId, skillsHash: thread.cursorAgentSkillsHash };
  }

  // One-time legacy: standing agent lived on the user for the default "main" thread.
  if (threadId === "main" && user.cursorAgentId) {
    const hash = user.cursorAgentSkillsHash ?? "";
    await updateWebThreadAgent(job.ownerUserId, source, threadId, user.cursorAgentId, hash);
    return { agentId: user.cursorAgentId, skillsHash: hash };
  }

  return {};
}

export async function saveAgentBindingForJob(
  job: Job,
  agentId: string,
  skillsHash: string,
): Promise<void> {
  if (job.source === "slack" && job.slackChannelId && job.slackThreadTs) {
    await updateSlackThreadAgent(job.ownerUserId, job.slackChannelId, job.slackThreadTs, agentId, skillsHash);
    return;
  }
  const source = webThreadSource(job.source ?? "web");
  const threadId = job.webThreadId ?? "main";
  await updateWebThreadAgent(job.ownerUserId, source, threadId, agentId, skillsHash);
}

export function mockAgentIdForJob(job: Job) {
  if (job.source === "slack" && job.slackChannelId && job.slackThreadTs) {
    return `mock-${threadKey(job.ownerUserId, job.slackChannelId, job.slackThreadTs).replace(/:/g, "-")}`;
  }
  const source = webThreadSource(job.source ?? "web");
  const threadId = job.webThreadId ?? "main";
  return `mock-${webThreadStoreKey(job.ownerUserId, source, threadId).replace(/:/g, "-")}`;
}

export async function threadHasStandingAgent(job: Job, user: PersonalUser) {
  const binding = await agentBindingForJob(job, user);
  return Boolean(binding.agentId);
}
