import { NextResponse } from "next/server";

import { messageView } from "@/lib/agent-api";
import { getConfig } from "@/lib/config";
import { getJob } from "@/lib/jobs";
import { reconcileErroredJob } from "@/lib/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request, cronSecret: string | undefined) {
  if (!cronSecret) return false;
  const auth = request.headers.get("authorization");
  const url = new URL(request.url);
  return auth === `Bearer ${cronSecret}` || url.searchParams.get("secret") === cronSecret;
}

/** Force-heal one stuck job (ops). Body: { jobId }. */
export async function POST(request: Request) {
  const cfg = getConfig();
  if (!authorized(request, cfg.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const before = await getJob(jobId, { fresh: true });
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const after = before.status === "error" ? await reconcileErroredJob(before) : before;
  const view = messageView(after);
  return NextResponse.json({
    ok: true,
    before: { status: before.status, error: before.error, replyLen: before.reply?.message?.trim().length ?? 0 },
    after: { status: after.status, error: after.error, replyLen: after.reply?.message?.trim().length ?? 0 },
    viewStatus: view.status,
    blockKinds: view.blocks.map((b) => b.kind),
  });
}
