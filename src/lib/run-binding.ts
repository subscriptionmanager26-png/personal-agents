import type { Job } from "@/lib/types";

/**
 * Bind PA jobs to Cursor run ids.
 *
 * Dashboard messages are jobs. Cursor conversation turns are runs on a shared
 * thread agent. Those counts can diverge (e.g. a re-dispatch creates a "ghost"
 * run with no new job). Reply text must come from the job's bound run — never
 * from "latest conversation" or "longest assistant message".
 */

export type RunCandidate = {
  id: string;
  createdAt?: string;
  status?: string;
};

/** How far after job.createdAt a run may still be attributed to that job. */
export const RUN_MATCH_AFTER_MS = 3 * 60_000;
/** Allow a few seconds of clock skew (agent create can precede the job patch). */
export const RUN_MATCH_BEFORE_MS = 15_000;

function parseMs(iso?: string) {
  if (!iso) return NaN;
  return Date.parse(iso);
}

/**
 * Greedy oldest-job-first assignment of unclaimed runs to jobs missing cursorRunId.
 * A run matches a job when its createdAt falls in
 * [job.createdAt - RUN_MATCH_BEFORE_MS, job.createdAt + RUN_MATCH_AFTER_MS].
 */
export function assignRunsToJobs(
  jobs: Pick<Job, "id" | "createdAt" | "cursorRunId">[],
  runs: RunCandidate[],
): Map<string, string> {
  const claimed = new Set(
    jobs.map((j) => j.cursorRunId).filter((id): id is string => Boolean(id)),
  );
  const available = [...runs]
    .filter((r) => r.id && !claimed.has(r.id) && Number.isFinite(parseMs(r.createdAt)))
    .sort((a, b) => parseMs(a.createdAt) - parseMs(b.createdAt));

  const needing = [...jobs]
    .filter((j) => !j.cursorRunId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const out = new Map<string, string>();
  for (const job of needing) {
    const jobMs = parseMs(job.createdAt);
    if (!Number.isFinite(jobMs)) continue;
    const lo = jobMs - RUN_MATCH_BEFORE_MS;
    const hi = jobMs + RUN_MATCH_AFTER_MS;
    const idx = available.findIndex((r) => {
      const t = parseMs(r.createdAt);
      return t >= lo && t <= hi;
    });
    if (idx < 0) continue;
    const [run] = available.splice(idx, 1);
    out.set(job.id, run.id);
    claimed.add(run.id);
  }
  return out;
}

/**
 * Final assistant text per user turn from a Cursor conversation payload.
 * Intermediate step messages (turn-N:step:1) are ignored; only the last
 * assistant bubble in each turn is kept.
 */
export function finalAssistantTextsByTurn(
  messages: { id?: string; type?: string; role?: string; text?: string }[],
): string[] {
  const byTurn = new Map<string, string>();
  const order: string[] = [];
  for (const m of messages) {
    const role = (m.type || m.role || "").toLowerCase();
    if (!role.includes("assistant") && role !== "ai_message") continue;
    const text = m.text?.trim();
    if (!text) continue;
    const id = m.id || "";
    const turn = id.startsWith("turn-") ? id.split(":")[0]! : `misc-${order.length}`;
    if (!byTurn.has(turn)) order.push(turn);
    byTurn.set(turn, text);
  }
  return order.map((t) => byTurn.get(t)!);
}
