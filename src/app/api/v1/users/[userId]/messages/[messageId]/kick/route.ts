import { kickJobDispatch } from "@/lib/dispatch-web";
import { apiError, requireApiUserLight } from "@/lib/api-auth";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string; messageId: string }> },
) {
  const { userId, messageId } = await params;
  const auth = await requireApiUserLight(_request, userId);
  if ("response" in auth) return auth.response;
  const user = await getUser(auth.ownerUserId);
  if (!user) return apiError(404, "user_not_found", "Create the user with PUT /api/v1/users/{userId} first.");
  const result = await kickJobDispatch(user, messageId);
  return Response.json(result, { status: 200 });
}