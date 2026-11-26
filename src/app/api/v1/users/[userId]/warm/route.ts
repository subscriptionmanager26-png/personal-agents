import { isValidThreadId } from "@/lib/agent-api";
import { apiError, readJson, requireApiUserLight } from "@/lib/api-auth";
import { warmAgentThread } from "@/lib/warm-thread";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireApiUserLight(request, (await params).userId);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
  if (!threadId || !isValidThreadId(threadId)) {
    return apiError(400, "invalid_thread_id", "threadId required.");
  }
  const bodyOut = await warmAgentThread(auth.ownerUserId, threadId);
  return Response.json(bodyOut);
}