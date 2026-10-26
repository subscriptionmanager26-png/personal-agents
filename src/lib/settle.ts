import { clientText } from "@/lib/client-text";
import { fetchFinalAssistantMessage } from "@/lib/cursor";
import { runtimeForUserId } from "@/lib/runtime";
import { getJob, listDispatchedJobs, patchJob } from "@/lib/jobs";
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
    await settleJob(job.id, job.ownerUserId);
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
      if (TERMINAL_RUN_STATUSES.includes(runStatus) || runResult) {
        await settleJob(job.id, job.ownerUserId, runResult ? { message: runResult } : undefined);
        return;
      }
    } catch {
      // fall through to agent-level checks
    }
  }

  try {
    const v1 = await getAgentV1(key, job.cursorAgentId);
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
  if (job.status === "replied" || job.status === "error") return job;

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
    const message = replyTextFromStream(job) || "Done.";
    await patchJob(job.id, job.ownerUserId, {
      status: "replied",
      reply: { message, receivedAt: doneAt },
    });
    return (await getJob(job.id, { fresh: true })) ?? job;
  }

  if (ACTIVE_JOB.has(job.status) && job.status !== "queued" && job.cursorAgentId) {
    await settleIfFinished(job).catch(() => undefined);
    return (await getJob(job.id, { fresh: true })) ?? job;
  }

  return job;
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
