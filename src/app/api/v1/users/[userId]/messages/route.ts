import { isValidThreadId, listMessages, messageView } from "@/lib/agent-api";
import { apiError, readJson, requireApiUser } from "@/lib/api-auth";
import { ChatRejected, enqueueChat } from "@/lib/dispatch-web";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireApiUser(request, (await params).userId);
    if ("response" in auth) return auth.response;
    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId") || undefined;
    if (threadId && !isValidThreadId(threadId)) return apiError(400, "invalid_thread_id", "Invalid threadId.");
    const messages = await listMessages(auth.user.id, {
      threadId,
      limit: Number(url.searchParams.get("limit")) || undefined,
      source: "api",
    });
    return Response.json({ messages });
  } catch (error) {
    console.error("[v1/users/messages GET]", error);
    return apiError(500, "internal_error", "Could not list messages.");
  }
}

/** Send a message; the reply arrives on the message's event stream. */
export async function POST(request: Request, { params }: Params) {
  const { userId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const text = typeof body?.text === "string" ? body.text : "";
  const threadId = typeof body?.threadId === "string" && body.threadId ? body.threadId : "main";
  if (!isValidThreadId(threadId)) return apiError(400, "invalid_thread_id", "threadId: 1-64 of letters, digits, . _ : -");

  try {
    const { job } = await enqueueChat({ user: auth.user, text, threadId, source: "api", attachments: body?.attachments });
    const base = `/api/v1/users/${encodeURIComponent(auth.externalId)}/messages/${job.id}`;
    return Response.json(
      { message: messageView(job), links: { self: base, events: `${base}/events` } },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ChatRejected) {
      const status = error.code === "busy" ? 409 : error.code === "not_allowed" ? 403 : 400;
      const code = error.code === "busy" ? "agent_busy" : error.code === "not_allowed" ? "user_disabled" : "invalid_message";
      return apiError(status, code, error.message);
    }
    throw error;
  }
}
