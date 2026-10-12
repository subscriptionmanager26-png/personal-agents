import { listOrderViews } from "@/lib/agent-api";
import { requireApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  return Response.json({ orders: await listOrderViews(auth.user.id) });
}
