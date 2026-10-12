import { randomId } from "@/lib/crypto";
import { appendStreamEvents } from "@/lib/jobs";
import { getStore, updateStore } from "@/lib/store";
import type { OrderProposal, OrderRequest, OrderStatus } from "@/lib/types";
import { appendAudit } from "@/lib/users";

export const ORDER_TTL_MS = 15 * 60_000;
const MAX_ORDERS_PER_USER = 200;
const SYMBOL = /^[A-Z0-9&_-]{1,30}$/;

function expiresAt(order: Pick<OrderProposal, "createdAt">) {
  return new Date(Date.parse(order.createdAt) + ORDER_TTL_MS).toISOString();
}

function withExpiry(order: OrderProposal): OrderProposal {
  if (order.status === "proposed" && Date.now() > Date.parse(expiresAt(order))) {
    return { ...order, status: "expired" };
  }
  return order;
}

/** Validates an agent's order proposal; numbers must be exact, not coerced from prose. */
export function validateOrder(raw: Record<string, unknown>): { order: OrderRequest } | { error: string } {
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  if (!SYMBOL.test(symbol)) return { error: "symbol must be an exchange trading symbol like INFY" };
  const exchange = raw.exchange === undefined ? "NSE" : raw.exchange;
  if (exchange !== "NSE" && exchange !== "BSE") return { error: "exchange must be NSE or BSE" };
  if (raw.side !== "BUY" && raw.side !== "SELL") return { error: "side must be BUY or SELL" };
  const quantity = raw.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
    return { error: "quantity must be a whole number between 1 and 100000" };
  }
  const orderType = raw.order_type ?? raw.orderType ?? "MARKET";
  if (orderType !== "MARKET" && orderType !== "LIMIT") return { error: "order_type must be MARKET or LIMIT" };
  let price: number | undefined;
  if (orderType === "LIMIT") {
    if (typeof raw.price !== "number" || !(raw.price > 0)) return { error: "LIMIT orders need a positive price" };
    price = Math.round(raw.price * 100) / 100;
  }
  const product = raw.product ?? "CNC";
  if (product !== "CNC" && product !== "MIS") return { error: "product must be CNC (delivery) or MIS (intraday)" };
  return { order: { exchange, symbol, side: raw.side, quantity, orderType, price, product } };
}

/** Records a proposal and asks the company's UI to get the user's confirmation. */
export async function proposeOrder(input: {
  ownerUserId: string;
  jobId: string;
  order: OrderRequest;
  rationale: string;
}) {
  const proposal: OrderProposal = {
    id: randomId("ord"),
    ownerUserId: input.ownerUserId,
    jobId: input.jobId,
    order: input.order,
    rationale: input.rationale.trim().slice(0, 600),
    status: "proposed",
    createdAt: new Date().toISOString(),
  };
  await updateStore((store) => {
    const list = store.orders[input.ownerUserId] ?? [];
    list.unshift(proposal);
    store.orders[input.ownerUserId] = list.slice(0, MAX_ORDERS_PER_USER);
  });
  await appendStreamEvents(input.jobId, input.ownerUserId, [
    {
      type: "action_required",
      action: {
        kind: "order_confirmation",
        orderId: proposal.id,
        order: proposal.order,
        rationale: proposal.rationale,
        expiresAt: expiresAt(proposal),
      },
    },
  ]);
  await appendAudit({
    ownerUserId: input.ownerUserId,
    type: "order.proposed",
    detail: `${proposal.id} ${proposal.order.side} ${proposal.order.quantity} ${proposal.order.symbol}`,
  });
  return proposal;
}

export async function listOrders(ownerUserId: string, limit = 50) {
  const store = await getStore();
  return (store.orders[ownerUserId] ?? []).slice(0, limit).map(withExpiry);
}

export async function getOrder(ownerUserId: string, orderId: string) {
  const store = await getStore();
  const order = (store.orders[ownerUserId] ?? []).find((o) => o.id === orderId && o.ownerUserId === ownerUserId);
  return order ? withExpiry(order) : undefined;
}

const OUTCOMES = new Set<OrderStatus>(["rejected", "executed", "failed"]);

/** Called by the company's backend after the user confirmed (and it placed the order) or rejected. */
export async function recordOrderOutcome(
  ownerUserId: string,
  orderId: string,
  outcome: { status: string; brokerOrderId?: string; message?: string },
): Promise<{ order: OrderProposal } | { error: string; code: 400 | 404 | 409 }> {
  if (!OUTCOMES.has(outcome.status as OrderStatus)) {
    return { error: "status must be rejected, executed or failed", code: 400 } as const;
  }
  const status = outcome.status as OrderStatus;
  const result = await updateStore((store) => {
    const order = (store.orders[ownerUserId] ?? []).find((o) => o.id === orderId && o.ownerUserId === ownerUserId);
    if (!order) return { error: "order not found", code: 404 } as const;
    const current = withExpiry(order);
    if (current.status === "expired" && status === "executed") {
      // The broker already filled it; record the truth rather than lose it.
    } else if (current.status !== "proposed") {
      return { error: `order is already ${current.status}`, code: 409 } as const;
    }
    order.status = status;
    order.brokerOrderId = outcome.brokerOrderId?.slice(0, 80);
    order.outcomeMessage = outcome.message?.slice(0, 300);
    order.decidedAt = new Date().toISOString();
    return { order: { ...order } } as const;
  });
  if ("order" in result) {
    await appendAudit({ ownerUserId, type: `order.${status}`, detail: `${orderId}${outcome.brokerOrderId ? ` broker ${outcome.brokerOrderId}` : ""}` });
  }
  return result;
}

export function describeOrder(o: OrderRequest) {
  const price = o.orderType === "LIMIT" ? ` at ₹${o.price}` : " at market";
  return `${o.side} ${o.quantity} ${o.symbol} (${o.exchange}, ${o.product})${price}`;
}
