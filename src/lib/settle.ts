import { fetchFinalAssistantMessage } from "@/lib/cursor";
import { runtimeForUserId } from "@/lib/runtime";
import { getJob, listDispatchedJobs, patchJob } from "@/lib/jobs";
import { addAutoEpisode } from "@/lib/memory";
import { postSlackMessage } from "@/lib/slack";
import type { Job } from "@/lib/types";

const settling = new Set<string>();

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
    const job = await getJob(jobId);
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

    const slackTs = await maybePostSlack(job, message);

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
  const { getAgent, getRun, TERMINAL_RUN_STATUSES } = await import("@/lib/cursor-api");
  const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
  if (job.cursorRunId) {
    const run = await getRun(key, job.cursorAgentId, job.cursorRunId);
    if (TERMINAL_RUN_STATUSES.includes((run.status || "").toUpperCase())) {
      await settleJob(job.id, job.ownerUserId);
    }
    return;
  }
  const agent = await getAgent(key, job.cursorAgentId);
  const status = (agent.status || "").toUpperCase();
  if (status.includes("FINISH") || status.includes("ERROR") || status === "IDLE" || status.includes("COMPLETE")) {
    await settleJob(job.id, job.ownerUserId);
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
