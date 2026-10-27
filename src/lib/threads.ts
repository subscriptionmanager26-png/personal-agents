import { messageView } from "@/lib/agent-api";
import { clientText } from "@/lib/client-text";
import { listJobsForUser } from "@/lib/jobs";
import { ensureFullReply, reconcileErroredJob, reconcileJob } from "@/lib/settle";
import { listWebThreadsForUser } from "@/lib/web-threads";
import type { ActionRequired, Job, JobAttachment, UiBlock } from "@/lib/types";

export type ChatThread = { id: string; title: string; updatedAt: string; working: boolean };

export type ChatMessage = {
  id: string;
  text: string;
  attachments: JobAttachment[];
  blocks: UiBlock[];
  actions: ActionRequired[];
  status: "working" | "completed" | "failed";
  error?: string;
  /** Progress labels the agent reported, oldest first. */
  steps: string[];
  createdAt: string;
  completedAt?: string;
};

const ACTIVE = new Set(["queued", "dispatched", "delivering"]);
const GENERIC_STEPS = new Set(["Queued", "Working on it", "Working on it…"]);

function webJobs(jobs: Job[]) {
  return jobs.filter((j) => (j.source ?? "web") === "web");
}

/** Web chat conversations, most recent first (one Cursor agent per thread). */
export async function listChatThreads(ownerUserId: string, limit = 40): Promise<ChatThread[]> {
  const jobs = webJobs(await listJobsForUser(ownerUserId, 400));
  return listWebThreadsForUser(ownerUserId, "web", jobs, limit);
}

/** Messages of one web thread, oldest first. */
export async function listThreadJobs(ownerUserId: string, threadId: string) {
  const jobs = webJobs(await listJobsForUser(ownerUserId, 400)).filter((j) => (j.webThreadId ?? "main") === threadId);
  const slice = jobs.slice(0, 60).reverse();
  const rows = await Promise.all(
    slice.map(async (job) => {
      if (ACTIVE.has(job.status)) return reconcileJob(job);
      if (job.status === "replied") return ensureFullReply(job);
      return job;
    }),
  );
  return Promise.all(
    rows.map(async (job) => {
      let row = job;
      if (row.status === "error") row = await reconcileErroredJob(row, rows);
      if (row.status === "replied") row = await ensureFullReply(row);
      return row;
    }),
  );
}

export function chatMessage(job: Job): ChatMessage {
  const view = messageView(job);
  const steps = (job.stream ?? []).flatMap((e) =>
    e.type === "status" && !GENERIC_STEPS.has(e.label) ? [clientText(e.label).replace(/…$/, "")] : [],
  );
  return {
    id: view.id,
    text: view.text,
    attachments: view.attachments,
    blocks: view.blocks,
    actions: view.actions,
    status: view.status,
    error: view.error,
    steps: [...new Set(steps)],
    createdAt: view.createdAt,
    completedAt: view.completedAt,
  };
}

export function newThreadId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
