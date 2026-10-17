import { listJobsForUser } from "@/lib/jobs";
import type { Job } from "@/lib/types";

export type ApiChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  working: boolean;
};

const ACTIVE = new Set(["queued", "dispatched", "delivering"]);

/** Group jobs into conversation threads (newest activity first). */
export function threadsFromJobs(jobs: Job[], limit = 40): ApiChatThread[] {
  const threads = new Map<string, ApiChatThread>();
  for (const job of jobs) {
    const id = job.webThreadId ?? "main";
    const at = job.updatedAt || job.createdAt;
    const working = ACTIVE.has(job.status);
    const existing = threads.get(id);
    if (!existing) {
      threads.set(id, {
        id,
        title: threadTitle(job.prompt),
        updatedAt: at,
        working,
      });
      continue;
    }
    if (at.localeCompare(existing.updatedAt) > 0) {
      existing.updatedAt = at;
      existing.title = threadTitle(job.prompt);
    }
    existing.working ||= working;
  }
  return [...threads.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

function threadTitle(prompt: string) {
  const t = prompt.replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  return t.length > 72 ? `${t.slice(0, 72)}…` : t;
}

/** Pocketedge www (`source: api`) conversations. */
export async function listApiChatThreads(ownerUserId: string, limit = 40): Promise<ApiChatThread[]> {
  const jobs = (await listJobsForUser(ownerUserId, 2000)).filter((j) => j.source === "api");
  return threadsFromJobs(jobs, limit);
}
