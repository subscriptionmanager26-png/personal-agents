import { NextResponse } from "next/server";

import { getOwnedJob } from "@/lib/job-access";
import { listMessageArtifacts } from "@/lib/message-artifacts";
import type { ArtifactItem } from "@/lib/trace-types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getOwnedJob(id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const items: ArtifactItem[] = await listMessageArtifacts(job);
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ items: [], error: message.slice(0, 200) });
  }
}
