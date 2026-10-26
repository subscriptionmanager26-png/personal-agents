import { NextResponse } from "next/server";

import { getJob } from "@/lib/jobs";
import { getOwnedJob } from "@/lib/job-access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await getOwnedJob(id);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const job = (await getJob(id, { fresh: true })) ?? owned;
  const settled = job.status === "replied" || job.status === "error";
  return NextResponse.json(
    { id: job.id, status: job.status, settled },
    { headers: { "Cache-Control": "no-store" } },
  );
}
