import { NextResponse } from "next/server";

import { listArtifacts } from "@/lib/cursor-api";
import { runtimeForUserId } from "@/lib/runtime";
import { getOwnedJob } from "@/lib/job-access";
import { isMockRunId, MOCK_ARTIFACTS } from "@/lib/mock-trace";
import { artifactKind, type ArtifactItem } from "@/lib/trace-types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getOwnedJob(id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (isMockRunId(job.cursorRunId)) {
    const items: ArtifactItem[] =
      job.status === "replied"
        ? MOCK_ARTIFACTS.map((a) => ({ ...a, kind: artifactKind(a.path) }))
        : [];
    return NextResponse.json({ items });
  }

  if (!job.cursorAgentId) return NextResponse.json({ items: [] });

  try {
    // Artifacts are agent-scoped; keep the ones written since this message was sent.
    const since = Date.parse(job.createdAt);
    const items: ArtifactItem[] = (await listArtifacts((await runtimeForUserId(job.ownerUserId)).cursorApiKey, job.cursorAgentId))
      .filter((a) => !a.updatedAt || Date.parse(a.updatedAt) >= since)
      .map((a) => ({ ...a, kind: artifactKind(a.path) }));
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ items: [], error: message.slice(0, 200) });
  }
}
