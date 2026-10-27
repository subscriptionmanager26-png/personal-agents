import { isValidThreadId, listMessages, messageView } from "@/lib/agent-api";
import { apiError, readJson, requireApiUser, requireApiUserLight } from "@/lib/api-auth";
import { isStoreReadError } from "@/lib/store-errors";
import { ChatRejected, enqueueChat } from "@/lib/dispatch-web";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Params) {
  const t0 = Date.now();
  let authMs = 0;
  let listMs = 0;
  try {
    const authStart = Date.now();
    const auth = await requireApiUserLight(request, (await params).userId);
    authMs = Date.now() - authStart;
    if ("response" in auth) {
      auth.response.headers.set("Server-Timing", `auth;dur=${authMs},total;dur=${Date.now() - t0}`);
      return auth.response;
    }
    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId") || undefined;
    if (threadId && !isValidThreadId(threadId)) return apiError(400, "invalid_thread_id", "Invalid threadId.");
    const listStart = Date.now();
    const messages = await listMessages(auth.ownerUserId, {
      threadId,
      limit: Number(url.searchParams.get("limit")) || undefined,
      source: "api",
    });
    listMs = Date.now() - listStart;
    return Response.json(
      { messages },
      {
        headers: {
          "Cache-Control": "private, no-cache",
          "Server-Timing": `auth;dur=${authMs},list;dur=${listMs},total;dur=${Date.now() - t0}`,
        },
      },
    );
  } catch (error) {
    console.error("[v1/users/messages GET]", error);
    if (isStoreReadError(error)) return apiError(503, error.code, error.message);
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
  const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
  if (!threadId || !isValidThreadId(threadId)) {
    return apiError(400, "invalid_thread_id", "threadId required: 1-64 of letters, digits, . _ : -");
  }

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
