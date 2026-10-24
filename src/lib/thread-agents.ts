import { threadKey } from "@/lib/jobs";
import { getStore } from "@/lib/store";
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
