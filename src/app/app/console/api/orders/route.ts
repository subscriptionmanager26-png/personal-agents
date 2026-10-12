import { orderView } from "@/lib/agent-api";
import { apiError } from "@/lib/api-auth";
import { recordOrderOutcome } from "@/lib/orders";

import { consoleUser } from "../shared";

/** Simulates the company backend: Confirm = "placed with the broker", Reject = rejected. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { user?: string; orderId?: string; decision?: string };
  const resolved = await consoleUser(body.user);
  if ("response" in resolved) return resolved.response;
  const outcome =
    body.decision === "confirm"
      ? { status: "executed", brokerOrderId: `SIM${Date.now().toString().slice(-9)}`, message: "Simulated fill from the console" }
      : { status: "rejected" };
  const result = await recordOrderOutcome(resolved.user.id, String(body.orderId ?? ""), outcome);
  if ("error" in result) return apiError(result.code, "order_error", result.error);
  return Response.json({ order: orderView(result.order) });
}
