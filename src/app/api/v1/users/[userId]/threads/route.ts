import { apiError, requireApiUser } from "@/lib/api-auth";
import { listApiChatThreads } from "@/lib/api-threads";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireApiUser(request, (await params).userId);
    if ("response" in auth) return auth.response;
    const threads = await listApiChatThreads(auth.user.id);
    return Response.json({ threads });
  } catch (error) {
    console.error("[v1/users/threads]", error);
    return apiError(500, "internal_error", "Could not list chat threads.");
  }
}
