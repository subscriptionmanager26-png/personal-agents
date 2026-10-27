import { clientText } from "@/lib/client-text";
import { fetchFinalAssistantMessage } from "@/lib/cursor";
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

function isResendFollowUp(prompt: string) {
  return /resend|send again|repeat (?:the |my )?(?:previous|last) message|previous message/i.test(prompt);
}

async function tryReviveFromCursorRun(job: Job): Promise<Job> {
  if (!job.cursorAgentId || !job.cursorRunId) return job;
  const { getRun, TERMINAL_RUN_STATUSES } = await import("@/lib/cursor-api");
  const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
  if (!key) return job;
  try {
    const run = await getRun(key, job.cursorAgentId, job.cursorRunId);
    const st = (run.status || "").toUpperCase();
    if (!TERMINAL_RUN_STATUSES.includes(st)) return job;
    let message = run.result?.trim() || "";
    if (!message || message.length < 80) {
      message = await fetchFinalAssistantMessage(job.ownerUserId, job.cursorAgentId, job.cursorRunId);
    }
    if (!message || message.startsWith("Agent status:") || message.length < 40) return job;
    await patchJob(job.id, job.ownerUserId, {
      status: "replied",
      reply: { message, receivedAt: new Date().toISOString() },
      event: { type: "replied", detail: "Recovered from Cursor run after stale error" },
    });
    return (await getJob(job.id, { fresh: true })) ?? job;
  } catch {
    return job;
  }
}

/** Jobs marked error after the agent already streamed UI, or after a later “resend” succeeded. */
export async function reconcileErroredJob(job: Job, threadPeers?: Job[]): Promise<Job> {
  if (job.status !== "error") return job;
  if (!isRecoverableThreadError(job.error) && !hasStreamBlocks(job)) return job;
  if (job.reply?.message?.trim()) {
    await patchJob(job.id, job.ownerUserId, { status: "replied" });
    return (await getJob(job.id, { fresh: true })) ?? job;
  }

  let row = await tryReviveFromCursorRun(job);
  if (row.status === "replied") return ensureFullReply(row);

  const peers = threadPeers ?? [];
  const donor = peers
    .filter((j) => j.id !== job.id && j.status === "replied" && Date.parse(j.createdAt) > Date.parse(job.createdAt))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .find((j) => isResendFollowUp(j.prompt));
  const donorText = donor?.reply?.message?.trim();
  if (!donor || !donorText || donorText.length < 200) return job;

  await patchJob(job.id, job.ownerUserId, {
    status: "replied",
    reply: {
      message: donorText,
      receivedAt: donor.reply?.receivedAt ?? new Date().toISOString(),
    },
    event: { type: "replied", detail: "Recovered from follow-up resend in thread" },
  });
  return ensureFullReply((await getJob(job.id, { fresh: true })) ?? job);
}

export async function ensureFullReply(job: Job): Promise<Job> {
  if (job.status !== "replied" || !job.cursorAgentId) return job;
  const stored = job.reply?.message?.trim() ?? "";

  try {
    let full = await fetchFinalAssistantMessage(job.ownerUserId, job.cursorAgentId, job.cursorRunId);
    if (job.cursorRunId && !(await isLatestJobOnAgent(job))) {
      const { getRun } = await import("@/lib/cursor-api");
      const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
      const runOnly = await getRun(key, job.cursorAgentId, job.cursorRunId).catch(() => null);
      const runText = runOnly?.result?.trim();
      if (runText) full = runText;
    }
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
    if (job.cursorAgentId && job.cursorRunId) {
      try {
        const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
        const { cancelRun } = await import("@/lib/cursor-api");
        await cancelRun(key, job.cursorAgentId, job.cursorRunId).catch(() => undefined);
      } catch {
        // continue
      }
    }
    await settleJob(job.id, job.ownerUserId).catch(() => undefined);
    await ensureFullReply(await getJob(job.id, { fresh: true }) ?? job).catch(() => undefined);
  }

  active = await reconcileActiveJobsInThread(ownerUserId, source, threadId);
  for (const job of active) {
    let fresh = (await getJob(job.id, { fresh: true })) ?? job;
    if (fresh.status === "replied" && fresh.reply?.message?.trim()) continue;
    if (hasStreamBlocks(fresh)) {
      fresh = await tryReviveFromCursorRun(fresh);
      if (fresh.status === "replied" && fresh.reply?.message?.trim()) continue;
    }
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
