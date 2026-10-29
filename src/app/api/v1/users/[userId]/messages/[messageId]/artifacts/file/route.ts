import { getOwnedMessage } from "@/lib/agent-api";
import { apiError, requireApiUser } from "@/lib/api-auth";
import { getArtifactDownloadUrl } from "@/lib/cursor-api";
import { isSafeArtifactPath } from "@/lib/job-access";
import { isMockRunId, mockArtifactContent } from "@/lib/mock-trace";
import { runtimeForUserId } from "@/lib/runtime";
import { artifactKind } from "@/lib/trace-types";

export const dynamic = "force-dynamic";

const TEXT_PREVIEW_LIMIT = 200_000;

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
  { params }: { params: Promise<{ userId: string; messageId: string }> },
) {
  const { userId, messageId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  const job = await getOwnedMessage(auth.user.id, messageId);
  if (!job) return apiError(404, "message_not_found", "No such message for this user.");

  const search = new URL(request.url).searchParams;
  const path = search.get("path") || "";
  if (!isSafeArtifactPath(path)) {
    return apiError(400, "invalid_path", "Invalid artifact path.");
  }
  const asText = search.get("as") === "text";
  if (asText && artifactKind(path) !== "text") {
    return apiError(400, "not_text", "This file is not available as text.");
  }

  if (isMockRunId(job.cursorRunId)) {
    const content = mockArtifactContent(path);
    if (!content) return apiError(404, "not_found", "Artifact not found.");
    if (asText) return textResponse(content.body);
    return new Response(content.body, {
      headers: {
        ...UNTRUSTED_HEADERS,
        "Content-Type": content.type,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  if (!job.cursorAgentId) return apiError(404, "not_found", "Artifact not found.");

  try {
    const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
    const { url, expiresAt } = await getArtifactDownloadUrl(key, job.cursorAgentId, path);
    if (asText) {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Artifact fetch failed (${res.status})`);
      return textResponse(await res.text());
    }
    // Presigned S3 URL (15 min). Prefer JSON so BFFs can hand it to the browser
    // without proxying bytes through Vercel.
    const name = path.split("/").pop() || "download";
    const wantsRedirect = new URL(request.url).searchParams.get("mode") === "redirect";
    if (wantsRedirect) {
      return new Response(null, {
        status: 302,
        headers: { Location: url, "Cache-Control": "private, no-store" },
      });
    }
    return Response.json(
      { url, expiresAt, name },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return apiError(502, "artifact_fetch_failed", message.slice(0, 200));
  }
}
