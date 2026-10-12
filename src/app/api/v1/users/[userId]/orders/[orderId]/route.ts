import { orderView } from "@/lib/agent-api";
import { apiError, readJson, requireApiUser } from "@/lib/api-auth";
import { getOrder, recordOrderOutcome } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string; orderId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { userId, orderId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  const order = await getOrder(auth.user.id, orderId);
  if (!order) return apiError(404, "order_not_found", "No such order for this user.");
  return Response.json({ order: orderView(order) });
}

/**
 * Report what happened after the user saw the proposal:
 * { "status": "rejected" } or, after your backend placed it with the broker,
 * { "status": "executed", "brokerOrderId": "…" } / { "status": "failed", "message": "…" }.
 */
export async function POST(request: Request, { params }: Params) {
  const { userId, orderId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const result = await recordOrderOutcome(auth.user.id, orderId, {
    status: typeof body?.status === "string" ? body.status : "",
    brokerOrderId: typeof body?.brokerOrderId === "string" ? body.brokerOrderId : undefined,
    message: typeof body?.message === "string" ? body.message : undefined,
  });
  if ("error" in result) {
    const code = result.code === 404 ? "order_not_found" : result.code === 409 ? "order_closed" : "invalid_status";
    return apiError(result.code, code, result.error);
  }
  return Response.json({ order: orderView(result.order) });
}
