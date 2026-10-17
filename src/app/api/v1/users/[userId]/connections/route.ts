import { apiError, requireApiUser } from "@/lib/api-auth";
import { apiConnectionsView } from "@/lib/api-connections-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  const view = await apiConnectionsView(auth.user.id);
  return Response.json(view);
}
