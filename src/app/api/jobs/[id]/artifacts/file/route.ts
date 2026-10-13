import { NextResponse } from "next/server";

import { getArtifactDownloadUrl } from "@/lib/cursor-api";
import { runtimeForUserId } from "@/lib/runtime";
import { getOwnedJob, isSafeArtifactPath } from "@/lib/job-access";
import { isMockRunId, mockArtifactContent } from "@/lib/mock-trace";
import { artifactKind } from "@/lib/trace-types";

export const dynamic = "force-dynamic";

const TEXT_PREVIEW_LIMIT = 200_000;

// Agent-written files are untrusted: never let them render as active content on our origin.
const UNTRUSTED_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox",
};

function textResponse(body: string) {
  return new Response(body.slice(0, TEXT_PREVIEW_LIMIT), {
    headers: {
      ...UNTRUSTED_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getOwnedJob(id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const search = new URL(request.url).searchParams;
  const path = search.get("path") || "";
  if (!isSafeArtifactPath(path)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }
  const asText = search.get("as") === "text";
  if (asText && artifactKind(path) !== "text") {
    return NextResponse.json({ error: "not_text" }, { status: 400 });
  }

  if (isMockRunId(job.cursorRunId)) {
    const content = mockArtifactContent(path);
    if (!content) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (asText) return textResponse(content.body);
    return new Response(content.body, {
      headers: {
        ...UNTRUSTED_HEADERS,
        "Content-Type": content.type,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  if (!job.cursorAgentId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
    const { url } = await getArtifactDownloadUrl(key, job.cursorAgentId, path);
    if (asText) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Artifact fetch failed (${res.status})`);
      return textResponse(await res.text());
    }
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}
