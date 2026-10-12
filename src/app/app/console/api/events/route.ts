import { getOwnedMessage, messageEventStream } from "@/lib/agent-api";
import { apiError } from "@/lib/api-auth";

import { consoleUser } from "../shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const resolved = await consoleUser(params.get("user"));
  if ("response" in resolved) return resolved.response;
  const messageId = params.get("message") || "";
  if (!(await getOwnedMessage(resolved.user.id, messageId))) {
    return apiError(404, "message_not_found", "No such message for this user.");
  }
  return messageEventStream(request, resolved.user.id, messageId);
}
