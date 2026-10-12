import { listMessages, listOrderViews, messageView } from "@/lib/agent-api";
import { apiError } from "@/lib/api-auth";
import { ChatRejected, enqueueChat } from "@/lib/dispatch-web";

import { consoleUser } from "../shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const resolved = await consoleUser(new URL(request.url).searchParams.get("user"));
  if ("response" in resolved) return resolved.response;
  const [messages, orders] = await Promise.all([
    listMessages(resolved.user.id, { source: "api", limit: 30 }),
    listOrderViews(resolved.user.id),
  ]);
  return Response.json({ messages: messages.reverse(), orders });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { user?: string; text?: string };
  const resolved = await consoleUser(body.user);
  if ("response" in resolved) return resolved.response;
  try {
    const { job } = await enqueueChat({ user: resolved.user, text: String(body.text ?? ""), source: "api" });
    return Response.json({ message: messageView(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof ChatRejected) return apiError(error.code === "busy" ? 409 : 400, error.code, error.message);
    throw error;
  }
}
