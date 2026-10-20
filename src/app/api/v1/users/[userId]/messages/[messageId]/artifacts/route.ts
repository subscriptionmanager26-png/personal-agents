import { getOwnedMessage } from "@/lib/agent-api";
import { apiError, requireApiUser } from "@/lib/api-auth";
import { listMessageArtifacts } from "@/lib/message-artifacts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string; messageId: string }> },
) {
  const { userId, messageId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  const job = await getOwnedMessage(auth.user.id, messageId);
  if (!job) return apiError(404, "message_not_found", "No such message for this user.");
  try {
    const items = await listMessageArtifacts(job);
    return Response.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ items: [], error: message.slice(0, 200) });
  }
}
