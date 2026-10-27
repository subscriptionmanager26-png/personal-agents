import { clientText } from "@/lib/client-text";
import {
  fetchAssistantMessageForThreadJob,
  fetchAssistantTextForRun,
  fetchFinalAssistantMessage,
} from "@/lib/cursor";
import { extractRunId } from "@/lib/cursor-api";
import { getWebThread, webThreadSource } from "@/lib/web-threads";
import { runtimeForUserId } from "@/lib/runtime";
import { getJob, listDispatchedJobs, patchJob, sortedJobsForUser } from "@/lib/jobs";
import { getStoreFresh } from "@/lib/store";
import type { JobSource } from "@/lib/types";
import { addAutoEpisode } from "@/lib/memory";
import { postSlackMessage } from "@/lib/slack";
import type { Job } from "@/lib/types";

const settling = new Set<string>();
const ACTIVE_JOB = new Set(["queued", "dispatched", "delivering"]);
const RUNNING_RUN = new Set(["RUNNING", "QUEUED", "PENDING", "ACTIVE", "IN_PROGRESS", "CREATING"]);

function replyTextFromStream(job: Job) {
  const fromReply = job.reply?.message?.trim();
  if (fromReply) return fromReply;
  const parts = (job.stream ?? []).flatMap((e) =>
    e.type === "block" && e.block.kind === "markdown" && e.block.text?.trim() ? [e.block.text.trim()] : [],
  );
  return parts.join("\n\n").trim();
}

function agentLooksIdle(status: string) {
  const s = status.toUpperCase();
  return (
    s.includes("FINISH") ||
    s.includes("ERROR") ||
    s === "IDLE" ||
    s.includes("COMPLETE") ||
    s.includes("STOP") ||
    s.includes("CANCEL")
  );
}

function agentLooksRunning(status: string) {
  const s = status.toUpperCase();
  return RUNNING_RUN.has(s) || (s.includes("RUN") && !agentLooksIdle(s));
}

async function maybePostSlack(
  job: NonNullable<Awaited<ReturnType<typeof getJob>>>,
  text: string,
) {
  if (job.source !== "slack") return undefined;
  if (!job.slackTeamId || !job.slackChannelId || !job.slackThreadTs) {
    return undefined;
  }
  try {
    return await postSlackMessage({
      teamId: job.slackTeamId,
      channel: job.slackChannelId,
      threadTs: job.slackThreadTs,
      text: text.slice(0, 35000),
    });
  } catch {
    return undefined;
  }
}

export async function settleJob(
  jobId: string,
  ownerUserId: string,
  opts?: { message?: string },
) {
  const key = `${ownerUserId}:${jobId}`;
  if (settling.has(key)) return;
  settling.add(key);
  try {
    const job = await getJob(jobId, { fresh: true });
    if (!job || job.ownerUserId !== ownerUserId) return;
    if (job.status === "replied" || job.status === "error") return;

    await patchJob(jobId, ownerUserId, {
      status: "delivering",
      event: { type: "settle", detail: "Delivering reply" },
    });

    const message =
      opts?.message ||
      (job.cursorAgentId
        ? await fetchFinalAssistantMessage(ownerUserId, job.cursorAgentId, job.cursorRunId)
        : "Agent finished with no message.");

    const slackTs = await maybePostSlack(job, clientText(message));

    // Every chat leaves a trace in memory, even when the agent saved nothing itself.
    const latest = await getJob(jobId);
    if (!latest?.memoryWrites) {
      try {
        await addAutoEpisode(ownerUserId, jobId, job.prompt, message);
      } catch {
        // memory is best-effort; never block the reply
      }
    }

    await patchJob(jobId, ownerUserId, {
      status: "replied",
      reply: {
        message,
        receivedAt: new Date().toISOString(),
        slackMessageTs: slackTs,
      },
      event: {
        type: "replied",
        detail:
          job.source === "slack"
            ? "Delivered to Slack thread"
            : "Reply ready in chat",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await patchJob(jobId, ownerUserId, {
      status: "error",
      error: detail,
      event: { type: "error", detail },
    });
    try {
      const job = await getJob(jobId);
      if (job && job.ownerUserId === ownerUserId) {
        await maybePostSlack(
          job,
          `Personal agent error: ${detail.slice(0, 500)}`,
        );
      }
    } catch {
      // ignore secondary failure
    }
  } finally {
    settling.delete(key);
  }
}

export async function settleByAgentId(agentId: string) {
  const jobs = await listDispatchedJobs();
  const matches = jobs.filter((j) => j.cursorAgentId === agentId);
  for (const job of matches) {
    await settleIfFinished(job);
  }
}

/** Settles one dispatched job if its Cursor run has ended. */
export async function settleIfFinished(job: Job) {
  if (!job.cursorAgentId || job.cursorAgentId.startsWith("mock-")) return;
  if (job.status !== "dispatched" && job.status !== "delivering") return;
  const { getAgent, getAgentV1, getRun, TERMINAL_RUN_STATUSES } = await import("@/lib/cursor-api");
  const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
  if (!key) return;

  let runStatus = "";
  let runResult: string | undefined;

  if (job.cursorRunId) {
    try {
      const run = await getRun(key, job.cursorAgentId, job.cursorRunId);
      runStatus = (run.status || "").toUpperCase();
      if (run.result?.trim()) runResult = run.result.trim();
      if (TERMINAL_RUN_STATUSES.includes(runStatus)) {
        await settleJob(job.id, job.ownerUserId, runResult ? { message: runResult } : undefined);
        return;
      }
      if (RUNNING_RUN.has(runStatus)) return;
    } catch {
      // fall through to agent-level checks
    }
  }

  try {
    const v1 = await getAgentV1(key, job.cursorAgentId);
    if (agentLooksRunning(v1.status || "")) return;
    if (agentLooksIdle(v1.status || "")) {
      await settleJob(job.id, job.ownerUserId);
      return;
    }
  } catch {
    // v0 fallback below
  }

  try {
    const agent = await getAgent(key, job.cursorAgentId);
    if (agentLooksIdle(agent.status || "")) {
      await settleJob(job.id, job.ownerUserId);
      return;
    }
  } catch {
    // conversation fallback below
  }

  if (runStatus && RUNNING_RUN.has(runStatus)) return;

  try {
    const v1 = await getAgentV1(key, job.cursorAgentId);
    if (agentLooksRunning(v1.status || "")) return;
  } catch {
    // continue
  }

  try {
    const preview = await fetchFinalAssistantMessage(job.ownerUserId, job.cursorAgentId, job.cursorRunId);
    if (preview && !preview.startsWith("Agent status:")) {
      await settleJob(job.id, job.ownerUserId, { message: preview });
    }
  } catch {
    // still dispatched; next read or poll will retry
  }
}

/** Fix stale job rows and settle with Cursor when a finished run was never delivered. */
export async function reconcileJob(job: Job): Promise<Job> {
  if (job.status === "replied") return ensureFullReply(job);
  if (job.status === "error") return job;

  const stream = job.stream ?? [];
  const doneAt = stream.find((e) => e.type === "done")?.at;
  const streamError = stream.find((e) => e.type === "error");
  if (streamError) {
    await patchJob(job.id, job.ownerUserId, {
      status: "error",
      error: streamError.message || "The agent could not finish.",
    });
    return (await getJob(job.id, { fresh: true })) ?? job;
  }
  if (doneAt) {
    let message = replyTextFromStream(job) || "Done.";
    if (job.cursorAgentId) {
      try {
        const full = await fetchFinalAssistantMessage(job.ownerUserId, job.cursorAgentId, job.cursorRunId);
        if (full && !full.startsWith("Agent status:") && full.length > message.length) message = full;
      } catch {
        // keep stream-derived text
      }
    }
    await patchJob(job.id, job.ownerUserId, {
      status: "replied",
      reply: { message, receivedAt: doneAt },
    });
    return ensureFullReply((await getJob(job.id, { fresh: true })) ?? job);
  }

  if (job.status === "queued") {
    const ageMs = Date.now() - Date.parse(job.createdAt);
    if (ageMs > 30 * 60_000) {
      await patchJob(job.id, job.ownerUserId, {
        status: "error",
        error: "Agent never started. Please send your message again.",
      });
      return (await getJob(job.id, { fresh: true })) ?? job;
    }
    if (ageMs > 90_000 && !job.cursorAgentId) {
      const { getUser } = await import("@/lib/users");
      const { dispatchJob } = await import("@/lib/cursor");
      const user = await getUser(job.ownerUserId);
      if (user) await dispatchJob(user, job).catch(() => undefined);
      return (await getJob(job.id, { fresh: true })) ?? job;
    }
  }

  if (ACTIVE_JOB.has(job.status) && job.status !== "queued" && job.cursorAgentId) {
    await settleIfFinished(job).catch(() => undefined);
    let row = (await getJob(job.id, { fresh: true })) ?? job;
    const ageMs = Date.now() - Date.parse(row.updatedAt || row.createdAt);
    if (ACTIVE_JOB.has(row.status) && ageMs > 3 * 60_000 && row.cursorRunId) {
      try {
        const key = (await runtimeForUserId(row.ownerUserId)).cursorApiKey;
        const { cancelRun } = await import("@/lib/cursor-api");
        await cancelRun(key, row.cursorAgentId!, row.cursorRunId).catch(() => undefined);
        await settleIfFinished(row).catch(() => undefined);
        row = (await getJob(job.id, { fresh: true })) ?? row;
      } catch {
        // keep row
      }
    }
    return row;
  }

  return job;
}

/** Reconcile in-flight jobs in one chat thread before accepting another message. */
export async function reconcileActiveJobsInThread(
  ownerUserId: string,
  source: JobSource,
  threadId: string,
): Promise<Job[]> {
  const store = await getStoreFresh();
  const jobs = sortedJobsForUser(store, ownerUserId).filter(
    (j) => (j.source ?? "web") === source && (j.webThreadId ?? "main") === threadId,
  );
  const stillActive: Job[] = [];
  for (const job of jobs.slice(0, 25)) {
    if (!ACTIVE_JOB.has(job.status)) continue;
    const row = await reconcileJob(job);
    if (ACTIVE_JOB.has(row.status)) stillActive.push(row);
  }
  return stillActive;
}

/** Clear stale in-flight jobs so a new user message can start (cancel Cursor runs if needed). */
/** Backfill job.reply from Cursor when the stream only captured part of the answer. */
async function isLatestJobOnAgent(job: Job) {
  const store = await getStoreFresh();
  const newest = sortedJobsForUser(store, job.ownerUserId).find((j) => j.cursorAgentId === job.cursorAgentId);
  return newest?.id === job.id;
}

function hasStreamBlocks(job: Job) {
  return (job.stream ?? []).some((e) => e.type === "block");
}

function isRecoverableThreadError(error?: string) {
  if (!error) return false;
  return (
    /still working on the previous message/i.test(error) ||
    /interrupted before it finished/i.test(error) ||
    /stopped so you could send/i.test(error)
  );
}

function resolveRunId(job: Job) {
  return job.cursorRunId || extractRunId(job.cursorBody);
}

async function resolveCursorAgentId(job: Job) {
  if (job.cursorAgentId) return job.cursorAgentId;
  const thread = await getWebThread(job.ownerUserId, webThreadSource(job.source ?? "api"), job.webThreadId ?? "main");
  return thread?.cursorAgentId;
}

async function markJobReplied(job: Job, message: string, detail: string) {
  await patchJob(job.id, job.ownerUserId, {
    status: "replied",
    reply: { message, receivedAt: new Date().toISOString() },
    error: undefined,
    event: { type: "replied", detail },
  });
  return (await getJob(job.id, { fresh: true })) ?? job;
}

async function tryReviveFromCursorRun(job: Job, agentId: string, runId: string): Promise<Job> {
  const { getRun, TERMINAL_RUN_STATUSES } = await import("@/lib/cursor-api");
  const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
  if (!key) return job;
  try {
    const run = await getRun(key, agentId, runId);
    const st = (run.status || "").toUpperCase();
    if (!TERMINAL_RUN_STATUSES.includes(st)) return job;
    let message = await fetchAssistantTextForRun(job.ownerUserId, agentId, runId);
    if (!message && (await isLatestJobOnAgent(job))) {
      message = await fetchFinalAssistantMessage(job.ownerUserId, agentId, runId);
    }
    if (!message || message.startsWith("Agent status:") || message.length < 40) return job;
    return markJobReplied(job, message, "Recovered from Cursor run after stale error");
  } catch {
    return job;
  }
}

function captionFromStreamBlocks(job: Job) {
  const titles = (job.stream ?? []).flatMap((e) =>
    e.type === "block" && (e.block.kind === "card" || e.block.kind === "table" || e.block.kind === "chart") && "title" in e.block && e.block.title
      ? [e.block.title]
      : [],
  );
  if (!titles.length) return "Here is what I found.";
  return `Here is what I found (${[...new Set(titles)].join("; ")}).`;
}

/**
 * Settle jobs wrongly left in error after the agent already ran (e.g. stale 409 busy).
 *
 * Order matters: if MCP already streamed UI under a false busy/interrupted error, complete
 * from those blocks first. Cursor fetches are best-effort enrichment and must not block healing
 * (they can hang, throw, or clear fields before a "last resort" path runs).
 */
export async function reconcileErroredJob(job: Job, threadPeers?: Job[]): Promise<Job> {
  if (job.status !== "error") return job;

  const blocks = hasStreamBlocks(job);

  if (job.reply?.message?.trim()) {
    await patchJob(job.id, job.ownerUserId, { status: "replied", error: undefined });
    return ensureFullReply((await getJob(job.id, { fresh: true })) ?? job);
  }

  // Heal any errored job that already has MCP UI blocks (cards/charts/tables).
  // We do NOT gate on the error string — previous heal attempts may have overwritten it.
  if (blocks) {
    const agentId = await resolveCursorAgentId(job).catch(() => undefined);
    const runId = resolveRunId(job);
    if (agentId && runId) {
      const revived = await tryReviveFromCursorRun(job, agentId, runId).catch(() => job);
      if (revived.status === "replied" && (revived.reply?.message?.trim().length ?? 0) > 40) {
        return ensureFullReply(revived);
      }
    }
    if (agentId && (threadPeers?.length ?? 0) > 0) {
      const turnText = await fetchAssistantMessageForThreadJob(job.ownerUserId, agentId, job, threadPeers!).catch(
        () => "",
      );
      if (turnText && turnText.length >= 40 && !turnText.startsWith("Agent status:")) {
        return ensureFullReply(await markJobReplied(job, turnText, "Recovered from thread agent conversation"));
      }
    }
    // Always complete from streamed blocks — never leave this class of job as failed.
    return markJobReplied(job, captionFromStreamBlocks(job), "Completed from streamed UI");
  }

  // No blocks: only try Cursor if the error is one we recognise as internal.
  if (!isRecoverableThreadError(job.error)) return job;

  const agentId = await resolveCursorAgentId(job).catch(() => undefined);
  const runId = resolveRunId(job);
  if (agentId && runId) {
    const revived = await tryReviveFromCursorRun(job, agentId, runId).catch(() => job);
    if (revived.status === "replied") return ensureFullReply(revived);
  }

  return (await getJob(job.id, { fresh: true })) ?? job;
}

export async function ensureFullReply(job: Job): Promise<Job> {
  if (job.status !== "replied" || !job.cursorAgentId) return job;
  const stored = job.reply?.message?.trim() ?? "";

  try {
    const full =
      job.cursorRunId && !(await isLatestJobOnAgent(job))
        ? await fetchAssistantTextForRun(job.ownerUserId, job.cursorAgentId, job.cursorRunId)
        : await fetchFinalAssistantMessage(job.ownerUserId, job.cursorAgentId, job.cursorRunId);
    if (!full || full.startsWith("Agent status:") || full.length <= stored.length + 40) return job;
    await patchJob(job.id, job.ownerUserId, {
      reply: {
        message: full,
        receivedAt: job.reply?.receivedAt ?? new Date().toISOString(),
      },
    });
    return (await getJob(job.id, { fresh: true })) ?? job;
  } catch {
    return job;
  }
}

export async function releaseThreadForNewMessage(
  ownerUserId: string,
  source: JobSource,
  threadId: string,
): Promise<void> {
  let active = await reconcileActiveJobsInThread(ownerUserId, source, threadId);
  if (!active.length) return;

  for (const job of active) {
    await settleIfFinished(job).catch(() => undefined);
  }

  active = await reconcileActiveJobsInThread(ownerUserId, source, threadId);
  for (const job of active) {
    await settleJob(job.id, job.ownerUserId).catch(() => undefined);
    await ensureFullReply((await getJob(job.id, { fresh: true })) ?? job).catch(() => undefined);
  }

  active = await reconcileActiveJobsInThread(ownerUserId, source, threadId);
  for (const job of active) {
    if (job.cursorAgentId && job.cursorRunId) {
      try {
        const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
        const { cancelRun } = await import("@/lib/cursor-api");
        await cancelRun(key, job.cursorAgentId, job.cursorRunId).catch(() => undefined);
      } catch {
        // continue
      }
    }
    await settleIfFinished((await getJob(job.id, { fresh: true })) ?? job).catch(() => undefined);
    await settleJob(job.id, job.ownerUserId).catch(() => undefined);
    await ensureFullReply((await getJob(job.id, { fresh: true })) ?? job).catch(() => undefined);
  }

  active = await reconcileActiveJobsInThread(ownerUserId, source, threadId);
  for (const job of active) {
    const fresh = (await getJob(job.id, { fresh: true })) ?? job;
    if (fresh.status === "replied" && fresh.reply?.message?.trim()) continue;
    if (fresh.status === "error") continue;
    await patchJob(job.id, job.ownerUserId, {
      status: "error",
      error: "This message was interrupted before it finished. Ask again if you need the rest.",
      event: { type: "error", detail: "Superseded by a new message" },
    });
  }
}

export async function pollDispatchedJobs() {
  const jobs = await listDispatchedJobs();
  for (const job of jobs) {
    try {
      await settleIfFinished(job);
    } catch {
      // keep polling later
    }
  }
}
