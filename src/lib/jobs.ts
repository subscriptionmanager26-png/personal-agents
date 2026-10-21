import { randomId } from "@/lib/crypto";
import { getStore, updateStore } from "@/lib/store";
import type {
  JobAttachment,
  Job,
  JobSource,
  JobStatus,
  SlackThreadRef,
  StreamEvent,
  StreamEventInput,
} from "@/lib/types";

const MAX_JOBS = 1000;
const MAX_STREAM_EVENTS = 200;

function isStreamClosed(job: Job) {
  return (job.stream ?? []).some((e) => e.type === "done" || e.type === "error");
}

/** Appends to the job's event stream; ignored once the stream has ended. */
function pushStream(job: Job, events: StreamEventInput[]) {
  const stream = (job.stream ??= []);
  const added: StreamEvent[] = [];
  for (const input of events) {
    if (isStreamClosed(job)) break;
    const terminal = input.type === "done" || input.type === "error";
    if (!terminal && stream.length >= MAX_STREAM_EVENTS - 1) continue;
    const event = { ...input, seq: stream.length + 1, at: new Date().toISOString() } as StreamEvent;
    stream.push(event);
    added.push(event);
  }
  return added;
}

/** Lifecycle events derived from status changes, so every code path emits them. */
function lifecycleEvents(next: Job, previous: JobStatus): StreamEventInput[] {
  const status = next.status;
  if (status === previous) return [];
  if (status === "dispatched") return [{ type: "status", label: "Working on it" }];
  if (status === "replied") {
    const text = next.reply?.message?.trim();
    return [...(text ? [{ type: "block" as const, block: { kind: "markdown" as const, text } }] : []), { type: "done" }];
  }
  if (status === "error") return [{ type: "error", message: next.error || "The agent could not finish." }];
  return [];
}

export async function appendStreamEvents(jobId: string, ownerUserId: string, events: StreamEventInput[]) {
  return updateStore((store) => {
    const job = store.jobs.find((j) => j.id === jobId && j.ownerUserId === ownerUserId);
    if (!job) return undefined;
    const added = pushStream(job, events);
    job.updatedAt = new Date().toISOString();
    return added;
  });
}

export async function createJob(input: {
  ownerUserId: string;
  source?: JobSource;
  prompt: string;
  attachments?: JobAttachment[];
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
    input.webThreadId || (source !== "slack" ? "main" : undefined);

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
    attachments: input.attachments?.length ? input.attachments : undefined,
    threadContext: input.threadContext,
    status: "queued",
    events: [{ at: now, type: "created", detail: "Job created" }],
    stream: [{ seq: 1, at: now, type: "status", label: "Queued" }],
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
    } else if (source !== "slack" && webThreadId) {
      const key = threadKey(input.ownerUserId, source, webThreadId);
      store.slackThreads[key] = {
        ownerUserId: input.ownerUserId,
        channelId: source,
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

function jobSortTime(job: Job) {
  const t = job.updatedAt || job.createdAt;
  return typeof t === "string" ? t : "";
}

export async function listJobsForUser(ownerUserId: string, limit = 50) {
  const store = await getStore();
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];
  return jobs
    .filter((j): j is Job => Boolean(j && typeof j === "object" && j.ownerUserId === ownerUserId))
    .sort((a, b) => jobSortTime(b).localeCompare(jobSortTime(a)))
    .slice(0, limit);
}

/** Earlier replied jobs in the same web thread or Slack thread as `job`, newest first. */
export async function listEarlierConversationJobs(job: Job, limit = 6) {
  const store = await getStore();
  return store.jobs
    .filter(
      (j) =>
        j.ownerUserId === job.ownerUserId &&
        j.id !== job.id &&
        j.createdAt < job.createdAt &&
        j.status === "replied" &&
        !!j.reply?.message &&
        (job.source === "slack"
          ? j.source === "slack" &&
            j.slackChannelId === job.slackChannelId &&
            j.slackThreadTs === job.slackThreadTs
          : (j.source ?? "web") === (job.source ?? "web") &&
            (j.webThreadId ?? "main") === (job.webThreadId ?? "main")),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
    const previous = job.status;
    Object.assign(job, rest, { updatedAt: new Date().toISOString() });
    pushStream(job, lifecycleEvents(job, previous));
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
