import { messageView } from "@/lib/agent-api";
import { listJobsForUser } from "@/lib/jobs";
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

/** Web chat conversations, most recent first; titled by their first message. */
export async function listChatThreads(ownerUserId: string, limit = 40): Promise<ChatThread[]> {
  const jobs = webJobs(await listJobsForUser(ownerUserId, 400));
  const threads = new Map<string, ChatThread>();
  for (const job of jobs) {
    const id = job.webThreadId ?? "main";
    const existing = threads.get(id);
    const title = job.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
    if (!existing) {
      threads.set(id, { id, title, updatedAt: job.createdAt, working: ACTIVE.has(job.status) });
    } else {
      existing.title = title;
      existing.working ||= ACTIVE.has(job.status);
    }
  }
  return [...threads.values()].slice(0, limit);
}

/** Messages of one web thread, oldest first. */
export async function listThreadJobs(ownerUserId: string, threadId: string) {
  const jobs = webJobs(await listJobsForUser(ownerUserId, 400)).filter((j) => (j.webThreadId ?? "main") === threadId);
  return jobs.slice(0, 60).reverse();
}

export function chatMessage(job: Job): ChatMessage {
  const view = messageView(job);
  const blocks = view.blocks.length || !job.reply?.message ? view.blocks : [{ kind: "markdown" as const, text: job.reply.message }];
  const steps = (job.stream ?? []).flatMap((e) =>
    e.type === "status" && !GENERIC_STEPS.has(e.label) ? [e.label.replace(/…$/, "")] : [],
  );
  return {
    id: view.id,
    text: view.text,
    attachments: view.attachments,
    blocks,
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
