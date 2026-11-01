import { randomId } from "@/lib/crypto";
import { getStore, getStoreFresh, updateStore } from "@/lib/store";
import {
  syncWebThreadActivity,
  touchWebThread,
  webThreadSource,
  webThreadStoreKey,
} from "@/lib/web-threads";
import type {
  JobAttachment,
  Job,
  JobSource,
  JobStatus,
  SlackThreadRef,
  StreamEvent,
  StreamEventInput,
  StoreData,
} from "@/lib/types";

import {
  MAX_JOBS_PER_USER,
  getJobRow,
  getWebThreadRow,
  listJobRowsForThread,
  relationalStoreEnabled,
  upsertJobRow,
  upsertWebThreadRow,
  writeJobRow,
} from "@/lib/store-relational";
import {
  tablesClaimJobDispatch,
  tablesFindJobByClientSendId,
  tablesGetJob,
  tablesListJobsForThread,
  tablesStoreEnabled,
  tablesWriteJob,
} from "@/lib/store-tables";

/** Global soft cap when assembling blob; per-user cap enforced via relational trim. */
const MAX_JOBS = 2000;
const MAX_STREAM_EVENTS = 200;

function trimJobsPerUser(store: { jobs: Job[] }) {
  const byOwner = new Map<string, Job[]>();
  for (const job of store.jobs) {
    const list = byOwner.get(job.ownerUserId) ?? [];
    list.push(job);
    byOwner.set(job.ownerUserId, list);
  }
  const kept: Job[] = [];
  for (const list of byOwner.values()) {
    list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    kept.push(...list.slice(0, MAX_JOBS_PER_USER));
  }
  kept.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  store.jobs = kept.slice(0, MAX_JOBS);
}

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

function evaluateDispatchClaim(job: Job): "already_dispatched" | "busy" | "ok" {
  if (
    job.cursorRunId ||
    job.status === "dispatched" ||
    job.status === "delivering" ||
    job.status === "replied"
  ) {
    return "already_dispatched";
  }
  if (job.dispatchClaimedAt) {
    const age = Date.now() - Date.parse(job.dispatchClaimedAt);
    if (Number.isFinite(age) && age >= 0 && age < DISPATCH_CLAIM_TTL_MS) {
      return "busy";
    }
  }
  return "ok";
}

function applyJobPatch(
  job: Job,
  patch: Partial<Job> & { event?: { type: string; detail: string } },
) {
  const { event, ...rest } = patch;
  const previous = job.status;
  Object.assign(job, rest, { updatedAt: new Date().toISOString() });
  if ("error" in patch && patch.error === undefined) delete job.error;
  pushStream(job, lifecycleEvents(job, previous));
  if (event) {
    job.events.push({
      at: new Date().toISOString(),
      type: event.type,
      detail: event.detail,
    });
  }
}

const ACTIVE_THREAD_STATUS = new Set(["queued", "dispatched", "delivering"]);

/** Update sidebar working flag from relational job rows (no full-store rewrite). */
async function syncThreadActivityLight(job: Job) {
  if (job.source === "slack") return;
  const source = webThreadSource(job.source ?? "web");
  const threadId = job.webThreadId ?? "main";
  const now = job.updatedAt || job.createdAt || new Date().toISOString();
  let thread =
    (await getWebThreadRow(job.ownerUserId, source, threadId).catch(() => undefined)) ?? undefined;
  if (!thread) {
    const { titleFromPrompt } = await import("@/lib/web-threads");
    thread = {
      id: threadId,
      ownerUserId: job.ownerUserId,
      source,
      title: titleFromPrompt(job.prompt),
      createdAt: job.createdAt || now,
      updatedAt: now,
    };
  }
  const peers = tablesStoreEnabled()
    ? await tablesListJobsForThread(job.ownerUserId, source, threadId, 25).catch(() => [] as Job[])
    : await listJobRowsForThread(job.ownerUserId, source, threadId, 25).catch(() => [] as Job[]);
  const byId = new Map(peers.map((j) => [j.id, j]));
  byId.set(job.id, job);
  thread.working = [...byId.values()].some((j) => ACTIVE_THREAD_STATUS.has(j.status));
  if (now.localeCompare(thread.updatedAt || "") >= 0) {
    thread.updatedAt = now;
    const { titleFromPrompt } = await import("@/lib/web-threads");
    const title = titleFromPrompt(job.prompt);
    if (title !== "New chat") thread.title = title;
  }
  if (tablesStoreEnabled()) {
    const { tablesWriteThread } = await import("@/lib/store-tables");
    await tablesWriteThread(thread).catch(() => undefined);
  }
  await upsertWebThreadRow(thread);
}

export async function appendStreamEvents(jobId: string, ownerUserId: string, events: StreamEventInput[]) {
  if (tablesStoreEnabled()) {
    try {
      const job = await tablesGetJob(jobId);
      if (!job || job.ownerUserId !== ownerUserId) return undefined;
      const added = pushStream(job, events);
      job.updatedAt = new Date().toISOString();
      await tablesWriteJob(job);
      await writeJobRow(job).catch(() => undefined);
      return added;
    } catch (error) {
      console.error("[appendStreamEvents] tables path failed; falling back", error);
    }
  }
  if (relationalStoreEnabled()) {
    try {
      const job = await getJobRow(jobId);
      if (!job || job.ownerUserId !== ownerUserId) return undefined;
      const added = pushStream(job, events);
      job.updatedAt = new Date().toISOString();
      await writeJobRow(job);
      return added;
    } catch (error) {
      console.error("[appendStreamEvents] light path failed; falling back to updateStore", error);
    }
  }
  return updateStore((store) => {
    const job = store.jobs.find((j) => j.id === jobId && j.ownerUserId === ownerUserId);
    if (!job) return undefined;
    const added = pushStream(job, events);
    job.updatedAt = new Date().toISOString();
    void upsertJobRow(job).catch(() => undefined);
    return added;
  });
}

/** Find a recent job with the same client send id (idempotent enqueue). */
export async function findJobByClientSendId(input: {
  ownerUserId: string;
  source: JobSource;
  webThreadId: string;
  clientSendId: string;
}): Promise<Job | undefined> {
  const needle = input.clientSendId.trim();
  if (!needle) return undefined;

  if (tablesStoreEnabled()) {
    try {
      const hit = await tablesFindJobByClientSendId({ ...input, clientSendId: needle });
      if (hit) return hit;
    } catch (error) {
      console.error("[findJobByClientSendId] tables path failed", error);
    }
  }

  if (relationalStoreEnabled()) {
    try {
      const rows = await listJobRowsForThread(input.ownerUserId, input.source, input.webThreadId, 40);
      const hit = rows.find((j) => j.clientSendId === needle);
      if (hit) return hit;
    } catch (error) {
      console.error("[findJobByClientSendId] light path failed; falling back to store", error);
    }
  }

  const store = await getStoreFresh();
  for (const job of sortedJobsForUser(store, input.ownerUserId)) {
    if (job.source !== input.source) continue;
    if ((job.webThreadId ?? "main") !== input.webThreadId) continue;
    if (job.clientSendId === needle) return job;
  }
  return undefined;
}

/** Short TTL so a dead after() worker can be reclaimed before the user gives up. */
const DISPATCH_CLAIM_TTL_MS = 90_000;

/**
 * Atomically claim Cursor dispatch for a job. Concurrent callers get busy /
 * already_dispatched so we never double createAgent/createRun for one send.
 */
export async function claimJobDispatch(
  jobId: string,
  ownerUserId: string,
): Promise<"claimed" | "already_dispatched" | "busy" | "missing"> {
  if (tablesStoreEnabled()) {
    try {
      return await tablesClaimJobDispatch(jobId, ownerUserId, Math.floor(DISPATCH_CLAIM_TTL_MS / 1000));
    } catch (error) {
      console.error("[claimJobDispatch] tables CAS failed; falling back", error);
    }
  }
  if (relationalStoreEnabled()) {
    try {
      const job = await getJobRow(jobId);
      if (!job || job.ownerUserId !== ownerUserId) return "missing";
      const state = evaluateDispatchClaim(job);
      if (state !== "ok") return state;
      const now = new Date().toISOString();
      job.dispatchClaimedAt = now;
      job.updatedAt = now;
      await writeJobRow(job);
      return "claimed";
    } catch (error) {
      console.error("[claimJobDispatch] light path failed; falling back to updateStore", error);
    }
  }
  return updateStore((store) => {
    const job = store.jobs.find((j) => j.id === jobId && j.ownerUserId === ownerUserId);
    if (!job) return "missing";
    const state = evaluateDispatchClaim(job);
    if (state !== "ok") return state;
    const now = new Date().toISOString();
    job.dispatchClaimedAt = now;
    job.updatedAt = now;
    void upsertJobRow(job).catch(() => undefined);
    return "claimed";
  });
}

export async function createJob(input: {
  ownerUserId: string;
  source?: JobSource;
  prompt: string;
  attachments?: JobAttachment[];
  threadContext?: string;
  webThreadId?: string;
  clientSendId?: string;
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
  const clientSendId = input.clientSendId?.trim() || undefined;

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
    clientSendId,
    status: "queued",
    events: [{ at: now, type: "created", detail: "Job created" }],
    stream: [{ seq: 1, at: now, type: "status", label: "Queued" }],
  };

  // Scale path: real pa_jobs table (CAS + owner indexes). Falls through to JSON shards.
  if (tablesStoreEnabled() && source !== "slack") {
    try {
      await tablesWriteJob(job);
      // Dual-write shard so RELATIONAL readers stay consistent during cutover.
      await writeJobRow(job).catch(() => undefined);
      if (webThreadId) {
        await touchWebThread({
          ownerUserId: input.ownerUserId,
          source: webThreadSource(source),
          threadId: webThreadId,
          prompt: input.prompt,
        });
        await syncThreadActivityLight(job).catch(() => undefined);
      }
      return job;
    } catch (error) {
      console.error("[createJob] tables path failed; falling back", error);
    }
  }

  // Hot path: write pa:j + thread rows only. Full-store rewrite was taking ~70s in prod
  // and starving the after() dispatch worker.
  if (relationalStoreEnabled() && source !== "slack") {
    try {
      await writeJobRow(job);
      if (webThreadId) {
        await touchWebThread({
          ownerUserId: input.ownerUserId,
          source: webThreadSource(source),
          threadId: webThreadId,
          prompt: input.prompt,
        });
        await syncThreadActivityLight(job).catch(() => undefined);
      }
      return job;
    } catch (error) {
      console.error("[createJob] light path failed; falling back to updateStore", error);
    }
  }

  const created = await updateStore((store) => {
    store.jobs.unshift(job);
    trimJobsPerUser(store);

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

    syncWebThreadActivity(store, job);
    return job;
  });

  if (source !== "slack" && webThreadId) {
    await touchWebThread({
      ownerUserId: input.ownerUserId,
      source: webThreadSource(source),
      threadId: webThreadId,
      prompt: input.prompt,
    });
  }

  if (created) await upsertJobRow(created).catch(() => undefined);
  return created;
}

export function threadKey(
  ownerUserId: string,
  channelId: string,
  threadTs: string,
) {
  return `${ownerUserId}:${channelId}:${threadTs}`;
}

export async function getJob(id: string, opts?: { fresh?: boolean }) {
  if (tablesStoreEnabled()) {
    try {
      const row = await tablesGetJob(id);
      if (row) return row;
    } catch {
      // fall through
    }
  }
  if (relationalStoreEnabled()) {
    try {
      const row = await getJobRow(id);
      if (row) return row;
    } catch {
      // fall through to blob/assembled store
    }
  }
  const store = opts?.fresh ? await getStoreFresh() : await getStore();
  return store.jobs.find((j) => j.id === id);
}

function jobSortTime(job: Job) {
  const t = job.updatedAt || job.createdAt;
  return typeof t === "string" ? t : "";
}

export function sortedJobsForUser(store: StoreData, ownerUserId: string): Job[] {
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];
  return jobs
    .filter((j): j is Job => Boolean(j && typeof j === "object" && j.ownerUserId === ownerUserId))
    .sort((a, b) => jobSortTime(b).localeCompare(jobSortTime(a)));
}

export async function listJobsForUser(ownerUserId: string, limit = 50) {
  return sortedJobsForUser(await getStore(), ownerUserId).slice(0, limit);
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
  if (tablesStoreEnabled()) {
    try {
      const job = (await tablesGetJob(id)) ?? (await getJobRow(id).catch(() => undefined));
      if (!job || job.ownerUserId !== ownerUserId) return undefined;
      applyJobPatch(job, patch);
      await tablesWriteJob(job);
      await writeJobRow(job).catch(() => undefined);
      await syncThreadActivityLight(job).catch(() => undefined);
      return job;
    } catch (error) {
      console.error("[patchJob] tables path failed; falling back", error);
    }
  }
  if (relationalStoreEnabled()) {
    try {
      const job = await getJobRow(id);
      if (!job || job.ownerUserId !== ownerUserId) return undefined;
      applyJobPatch(job, patch);
      await writeJobRow(job);
      await syncThreadActivityLight(job).catch(() => undefined);
      return job;
    } catch (error) {
      console.error("[patchJob] light path failed; falling back to updateStore", error);
    }
  }
  return updateStore((store) => {
    const job = store.jobs.find(
      (j) => j.id === id && j.ownerUserId === ownerUserId,
    );
    if (!job) return undefined;
    applyJobPatch(job, patch);
    syncWebThreadActivity(store, job);
    void upsertJobRow(job).catch(() => undefined);
    const source = webThreadSource(job.source ?? "web");
    const threadKeyId = webThreadStoreKey(job.ownerUserId, source, job.webThreadId ?? "main");
    const thread = store.webThreads[threadKeyId];
    if (thread) void upsertWebThreadRow(thread).catch(() => undefined);
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
  const store = await getStoreFresh();
  return store.jobs.filter((j) => j.status === "dispatched" && j.cursorAgentId);
}
