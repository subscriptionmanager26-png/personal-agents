import { fetchFinalAssistantMessage } from "@/lib/cursor";
import { getJob, listDispatchedJobs, patchJob } from "@/lib/jobs";
import { postSlackMessage } from "@/lib/slack";

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
        ? await fetchFinalAssistantMessage(job.cursorAgentId, job.cursorRunId)
        : "Agent finished with no message.");

    const slackTs = await maybePostSlack(job, message);

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

export async function pollDispatchedJobs() {
  const jobs = await listDispatchedJobs();
  for (const job of jobs) {
    if (!job.cursorAgentId || job.cursorAgentId.startsWith("mock-")) continue;
    try {
      const { getAgent, getRun, TERMINAL_RUN_STATUSES } = await import(
        "@/lib/cursor-api"
      );
      if (job.cursorRunId) {
        const run = await getRun(job.cursorAgentId, job.cursorRunId);
        if (TERMINAL_RUN_STATUSES.includes((run.status || "").toUpperCase())) {
          await settleJob(job.id, job.ownerUserId);
        }
        continue;
      }
      const agent = await getAgent(job.cursorAgentId);
      const status = (agent.status || "").toUpperCase();
      if (
        status.includes("FINISH") ||
        status.includes("ERROR") ||
        status === "IDLE" ||
        status.includes("COMPLETE")
      ) {
        await settleJob(job.id, job.ownerUserId);
      }
    } catch {
      // keep polling later
    }
  }
}
