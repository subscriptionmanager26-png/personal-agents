import { apiError, requireApiUser } from "@/lib/api-auth";
import { getJob } from "@/lib/jobs";
import { listMessageArtifacts } from "@/lib/message-artifacts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string; messageId: string }> },
) {
  const { userId, messageId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  // Snapshot only — do not reconcile/dispatch here (that hung artifacts + could mark
  // queued jobs as "never started" while the chat UI was merely listing files).
  const job = await getJob(messageId, { fresh: true });
  if (!job || job.ownerUserId !== auth.user.id) {
    return apiError(404, "message_not_found", "No such message for this user.");
  }
  if (!job.cursorAgentId) {
    return Response.json({ items: [] });
  }
  try {
    const items = await listMessageArtifacts(job);
    return Response.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ items: [], error: message.slice(0, 200) }, { status: 200 });
  }
}
