import { randomId } from "@/lib/crypto";
import { getStore, updateStore } from "@/lib/store";
import type { Job, JobSource, JobStatus, SlackThreadRef } from "@/lib/types";

const MAX_JOBS = 200;

export async function createJob(input: {
  ownerUserId: string;
  source?: JobSource;
  prompt: string;
  threadContext?: string;
  webThreadId?: string;
  slackTeamId?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  slackUserId?: string;
  slackMessageTs?: string;
}): Promise<Job> {
  const now = new Date().toISOString();
  const source = input.source || (input.slackChannelId ? "slack" : "web");
  const webThreadId =
    input.webThreadId || (source === "web" ? "main" : undefined);

  const job: Job = {
    id: randomId("job"),
    ownerUserId: input.ownerUserId,
    createdAt: now,
    updatedAt: now,
    source,
    slackTeamId: input.slackTeamId,
    slackChannelId: input.slackChannelId,
    slackThreadTs: input.slackThreadTs,
    slackUserId: input.slackUserId,
    slackMessageTs: input.slackMessageTs,
    webThreadId,
    prompt: input.prompt,
    threadContext: input.threadContext,
    status: "queued",
    events: [{ at: now, type: "created", detail: "Job created" }],
  };

  return updateStore((store) => {
    store.jobs.unshift(job);
    store.jobs = store.jobs.slice(0, MAX_JOBS);

    if (
      source === "slack" &&
      input.slackChannelId &&
      input.slackThreadTs
    ) {
      const key = threadKey(
        input.ownerUserId,
        input.slackChannelId,
        input.slackThreadTs,
      );
      store.slackThreads[key] = {
        ownerUserId: input.ownerUserId,
        channelId: input.slackChannelId,
        threadTs: input.slackThreadTs,
        lastJobId: job.id,
        updatedAt: now,
      };
    } else if (source === "web" && webThreadId) {
      const key = threadKey(input.ownerUserId, "web", webThreadId);
      store.slackThreads[key] = {
        ownerUserId: input.ownerUserId,
        channelId: "web",
        threadTs: webThreadId,
        lastJobId: job.id,
        updatedAt: now,
      };
    }

    return job;
  });
}

export function threadKey(
  ownerUserId: string,
  channelId: string,
  threadTs: string,
) {
  return `${ownerUserId}:${channelId}:${threadTs}`;
}

export async function getJob(id: string) {
  const store = await getStore();
  return store.jobs.find((j) => j.id === id);
}

export async function listJobsForUser(ownerUserId: string, limit = 50) {
  const store = await getStore();
  return store.jobs
    .filter((j) => j.ownerUserId === ownerUserId)
    .slice(0, limit);
}

export async function listAllJobs(limit = 100) {
  const store = await getStore();
  return store.jobs.slice(0, limit);
}

export async function findThreadJob(
  ownerUserId: string,
  channelId: string,
  threadTs: string,
) {
  const store = await getStore();
  const ref = store.slackThreads[
    threadKey(ownerUserId, channelId, threadTs)
  ] as SlackThreadRef | undefined;
  if (!ref || ref.ownerUserId !== ownerUserId) return undefined;
  if (!ref.lastJobId) return undefined;
  const job = store.jobs.find(
    (j) => j.id === ref.lastJobId && j.ownerUserId === ownerUserId,
  );
  return job;
}

export async function patchJob(
  id: string,
  ownerUserId: string,
  patch: Partial<Job> & { event?: { type: string; detail: string } },
) {
  return updateStore((store) => {
    const job = store.jobs.find(
      (j) => j.id === id && j.ownerUserId === ownerUserId,
    );
    if (!job) return undefined;
    const { event, ...rest } = patch;
    Object.assign(job, rest, { updatedAt: new Date().toISOString() });
    if (event) {
      job.events.push({
        at: new Date().toISOString(),
        type: event.type,
        detail: event.detail,
      });
    }
    return job;
  });
}

export async function setJobStatus(
  id: string,
  ownerUserId: string,
  status: JobStatus,
  detail: string,
) {
  return patchJob(id, ownerUserId, {
    status,
    event: { type: "status", detail },
  });
}

export async function markSlackMessageProcessed(key: string) {
  return updateStore((store) => {
    if (store.processedSlackMessages.includes(key)) return false;
    store.processedSlackMessages.unshift(key);
    store.processedSlackMessages = store.processedSlackMessages.slice(0, 2000);
    return true;
  });
}

export async function listDispatchedJobs() {
  const store = await getStore();
  return store.jobs.filter((j) => j.status === "dispatched" && j.cursorAgentId);
}
