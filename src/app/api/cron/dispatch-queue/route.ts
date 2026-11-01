import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { dispatchJob } from "@/lib/cursor";
import { getJob, patchJob } from "@/lib/jobs";
import {
  tablesFailDispatchLease,
  tablesLeaseDispatchBatch,
  tablesMarkDispatchDone,
  tablesStoreEnabled,
} from "@/lib/store-tables";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request, cronSecret: string | undefined) {
  if (!cronSecret) return false;
  const auth = request.headers.get("authorization");
  const url = new URL(request.url);
  return auth === `Bearer ${cronSecret}` || url.searchParams.get("secret") === cronSecret;
}

/**
 * Drain durable pa_dispatch_queue. Primary delivery when PERSONAL_AGENTS_TABLES=1;
 * after() on enqueue is only a best-effort nudge.
 */
export async function GET(request: Request) {
  const cfg = getConfig();
  if (!authorized(request, cfg.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!tablesStoreEnabled()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "tables_disabled" });
  }

  const workerId = `cron-${Date.now().toString(36)}`;
  const leased = await tablesLeaseDispatchBatch(workerId, 8);
  const results: Array<{ jobId: string; ok: boolean; error?: string }> = [];

  for (const row of leased) {
    try {
      const job = await getJob(row.job_id, { fresh: true });
      if (!job) {
        await tablesMarkDispatchDone(row.job_id);
        results.push({ jobId: row.job_id, ok: false, error: "missing_job" });
        continue;
      }
      if (job.cursorRunId || job.status === "replied" || job.status === "error") {
        await tablesMarkDispatchDone(row.job_id);
        results.push({ jobId: row.job_id, ok: true });
        continue;
      }
      const user = await getUser(row.owner_user_id);
      if (!user) {
        await tablesFailDispatchLease(row.id, "owner_missing", 60);
        results.push({ jobId: row.job_id, ok: false, error: "owner_missing" });
        continue;
      }
      await dispatchJob(user, job);
      await tablesMarkDispatchDone(row.job_id);
      results.push({ jobId: row.job_id, ok: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[cron/dispatch-queue]", row.job_id, detail);
      if (row.attempts >= 5) {
        await patchJob(row.job_id, row.owner_user_id, {
          status: "error",
          error: detail,
          event: { type: "error", detail },
        }).catch(() => undefined);
        await tablesMarkDispatchDone(row.job_id).catch(() => undefined);
      } else {
        await tablesFailDispatchLease(row.id, detail, Math.min(30 * row.attempts, 300)).catch(
          () => undefined,
        );
      }
      results.push({ jobId: row.job_id, ok: false, error: detail.slice(0, 200) });
    }
  }

  return NextResponse.json({ ok: true, workerId, leased: leased.length, results });
}

export async function POST(request: Request) {
  return GET(request);
}
