import { NextResponse } from "next/server";

import { listArtifacts } from "@/lib/cursor-api";
import { runtimeForUserId } from "@/lib/runtime";
import { getOwnedJob } from "@/lib/job-access";
import { listJobsForUser } from "@/lib/jobs";
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
    // Artifacts are agent-scoped and one agent serves many messages: a message owns the files
    // written after it was sent and before the next message to the same agent.
    const since = Date.parse(job.createdAt);
    const next = (await listJobsForUser(job.ownerUserId, 1000))
      .filter((j) => j.cursorAgentId === job.cursorAgentId && Date.parse(j.createdAt) > since)
      .reduce((min, j) => Math.min(min, Date.parse(j.createdAt)), Infinity);
    const items: ArtifactItem[] = (await listArtifacts((await runtimeForUserId(job.ownerUserId)).cursorApiKey, job.cursorAgentId))
      .filter((a) => {
        if (!a.updatedAt) return next === Infinity;
        const at = Date.parse(a.updatedAt);
        return at >= since && at < next;
      })
      .map((a) => ({ ...a, kind: artifactKind(a.path) }));
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ items: [], error: message.slice(0, 200) });
  }
}
