import { getOwnedMessage, messageView } from "@/lib/agent-api";
import { apiError, requireApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string; messageId: string }> },
) {
  const { userId, messageId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") !== "0";
  const job = await getOwnedMessage(auth.user.id, messageId, { deep });
  if (!job) return apiError(404, "message_not_found", "No such message for this user.");
  return Response.json({ message: messageView(job) });
}
