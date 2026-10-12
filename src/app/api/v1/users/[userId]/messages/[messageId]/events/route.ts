import { getOwnedMessage, messageEventStream } from "@/lib/agent-api";
import { apiError, requireApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string; messageId: string }> },
) {
  const { userId, messageId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  if (!(await getOwnedMessage(auth.user.id, messageId))) {
    return apiError(404, "message_not_found", "No such message for this user.");
  }
  return messageEventStream(request, auth.user.id, messageId);
}
