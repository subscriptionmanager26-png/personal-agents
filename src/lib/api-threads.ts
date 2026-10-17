import { listJobsForUser } from "@/lib/jobs";

export type ApiChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  working: boolean;
};

const ACTIVE = new Set(["queued", "dispatched", "delivering"]);

/** Pocketedge API (`source: api`) conversations, most recent first. */
export async function listApiChatThreads(ownerUserId: string, limit = 40): Promise<ApiChatThread[]> {
  const jobs = (await listJobsForUser(ownerUserId, 400)).filter((j) => j.source === "api");
  const threads = new Map<string, ApiChatThread>();
  for (const job of jobs) {
    const id = job.webThreadId ?? "main";
    const title = job.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
    const working = ACTIVE.has(job.status);
    const existing = threads.get(id);
    if (!existing) {
      threads.set(id, { id, title, updatedAt: job.createdAt, working });
    } else {
      if (new Date(job.createdAt) > new Date(existing.updatedAt)) {
        existing.updatedAt = job.createdAt;
        existing.title = title;
      }
      existing.working ||= working;
    }
  }
  return [...threads.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
