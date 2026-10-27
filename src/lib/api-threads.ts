import { sortedJobsForUser } from "@/lib/jobs";
import { getStoreFresh } from "@/lib/store";
import { reconcileJob } from "@/lib/settle";
import type { Job } from "@/lib/types";
import { listWebThreadsForUser } from "@/lib/web-threads";

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
    if (!job || typeof job !== "object") continue;
    const id = job.webThreadId ?? "main";
    const at = job.updatedAt || job.createdAt || "";
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
    if (at.localeCompare(existing.updatedAt || "") > 0) {
      existing.updatedAt = at;
      existing.title = threadTitle(job.prompt);
    }
    existing.working ||= working;
  }
  return [...threads.values()]
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);
}

function threadTitle(prompt: string | undefined) {
  const t = (prompt ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "New chat";
  return t.length > 72 ? `${t.slice(0, 72)}…` : t;
}

/** Pocketedge www (`source: api`) conversations. */
export async function listApiChatThreads(ownerUserId: string, limit = 40): Promise<ApiChatThread[]> {
  const store = await getStoreFresh();
  const raw = sortedJobsForUser(store, ownerUserId)
    .filter((j) => j.source === "api")
    .slice(0, 600);
  const jobs: Job[] = [];
  for (const job of raw) {
    jobs.push(ACTIVE.has(job.status) ? await reconcileJob(job) : job);
  }
  return listWebThreadsForUser(ownerUserId, "api", jobs, limit, store);
}
