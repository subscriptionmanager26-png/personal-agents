import { NextResponse } from "next/server";

import { getArtifactDownloadUrl } from "@/lib/cursor-api";
import { getOwnedJob, isSafeArtifactPath } from "@/lib/job-access";
import { isMockRunId, mockArtifactContent } from "@/lib/mock-trace";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getOwnedJob(id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const path = new URL(request.url).searchParams.get("path") || "";
  if (!isSafeArtifactPath(path)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  if (isMockRunId(job.cursorRunId)) {
    const content = mockArtifactContent(path);
    if (!content) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return new Response(content.body, {
      headers: { "Content-Type": content.type, "Cache-Control": "private, max-age=300" },
    });
  }

  if (!job.cursorAgentId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const { url } = await getArtifactDownloadUrl(job.cursorAgentId, path);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}
