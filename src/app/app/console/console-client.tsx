"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AgentBlock } from "@/components/agent-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MessageView, orderView } from "@/lib/agent-api";
import type { ActionRequired, StreamEvent } from "@/lib/types";

type OrderView = ReturnType<typeof orderView>;
type Live = { messageId: string; events: StreamEvent[] };

const EVENT_TYPES = ["status", "block", "action_required", "done", "error"] as const;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body as T;
}

function ActionView({
  action,
  order,
  onDecide,
}: {
  action: ActionRequired;
  order?: OrderView;
  onDecide: (orderId: string, decision: "confirm" | "reject") => void;
}) {
  if (action.kind === "connection_login") {
    return (
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">Log in to {action.service}</p>
        {action.message && <p className="mt-1 text-muted-foreground">{action.message}</p>}
        <a
          href={action.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-primary-foreground"
        >
          Log in to {action.service}
        </a>
      </div>
    );
  }
  const o = action.order;
  const status = order?.status ?? "proposed";
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Order for your confirmation</p>
      <p className="mt-1 text-base font-medium">
        {o.side} {o.quantity} {o.symbol}{" "}
        <span className="text-sm font-normal text-muted-foreground">
          {o.exchange} · {o.product} · {o.orderType === "LIMIT" ? `limit ₹${o.price}` : "market"}
        </span>
      </p>
      <p className="mt-1 text-muted-foreground">{action.rationale}</p>
      {status === "proposed" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => onDecide(action.orderId, "confirm")}>
            Confirm
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide(action.orderId, "reject")}>
            Reject
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium">
          {status === "executed" ? `Placed · broker id ${order?.brokerOrderId}` : status}
        </p>
      )}
    </div>
  );
}

export function ConsoleClient({ knownUsers }: { knownUsers: string[] }) {
  const [userId, setUserId] = useState(knownUsers[0] ?? "user_1001");
  const [name, setName] = useState("");
  const [active, setActive] = useState<string>();
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [live, setLive] = useState<Live>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = async (id = active) => {
    if (!id) return;
    const data = await json<{ messages: MessageView[]; orders: OrderView[] }>(
      await fetch(`/app/console/api/messages?user=${encodeURIComponent(id)}`),
    );
    setMessages(data.messages);
    setOrders(data.orders);
  };

  useEffect(() => () => sourceRef.current?.close(), []);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, live]);

  const openUser = async () => {
    setError("");
    try {
      await json(
        await fetch("/app/console/api/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalId: userId.trim(), name: name.trim() || undefined }),
        }),
      );
      sourceRef.current?.close();
      setLive(undefined);
      setActive(userId.trim());
      await refresh(userId.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const listen = (messageId: string) => {
    sourceRef.current?.close();
    setLive({ messageId, events: [] });
    const es = new EventSource(
      `/app/console/api/events?user=${encodeURIComponent(active!)}&message=${encodeURIComponent(messageId)}`,
    );
    sourceRef.current = es;
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (e) => {
        const event = JSON.parse((e as MessageEvent).data) as StreamEvent;
        setLive((cur) => (cur && cur.messageId === messageId ? { ...cur, events: [...cur.events, event] } : cur));
        if (type === "action_required") void refresh();
        if (type === "done" || type === "error") {
          es.close();
          void refresh().then(() => setLive(undefined));
        }
      });
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !text.trim()) return;
    setError("");
    try {
      const { message } = await json<{ message: MessageView }>(
        await fetch("/app/console/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: active, text }),
        }),
      );
      setText("");
      setMessages((m) => [...m, message]);
      listen(message.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const decide = async (orderId: string, decision: "confirm" | "reject") => {
    setError("");
    try {
      await json(
        await fetch("/app/console/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: active, orderId, decision }),
        }),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const ordersById = new Map(orders.map((o) => [o.id, o]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 p-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Your user id</p>
          <Input value={userId} onChange={(e) => setUserId(e.target.value)} list="known-users" className="w-48" />
          <datalist id="known-users">
            {knownUsers.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Name (optional)</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-40" placeholder="Priya" />
        </div>
        <Button onClick={openUser} variant={active ? "outline" : "default"}>
          {active ? "Switch user" : "Open agent"}
        </Button>
        {active && <p className="text-sm text-muted-foreground">Talking as <code>{active}</code></p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {active && (
        <>
          <div className="space-y-5 rounded-xl border border-border/70 bg-background/50 p-4">
            {!messages.length && (
              <p className="text-sm text-muted-foreground">
                Try “Review my portfolio”, “Backtest 120-day momentum” or “Buy 10 INFY”.
              </p>
            )}
            {messages.map((m) => {
              const isLive = live?.messageId === m.id;
              const events = isLive ? live.events : [];
              const blocks = isLive ? events.flatMap((e) => (e.type === "block" ? [e.block] : [])) : m.blocks;
              const actions = isLive
                ? events.flatMap((e) => (e.type === "action_required" ? [e.action] : []))
                : m.actions;
              const statusLabel = [...events].reverse().find((e) => e.type === "status");
              const working = isLive ? !events.some((e) => e.type === "done" || e.type === "error") : m.status === "working";
              const failed = isLive ? events.find((e) => e.type === "error") : undefined;
              return (
                <div key={m.id} className="space-y-2">
                  <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {m.text}
                  </div>
                  <div className="mr-auto max-w-[92%] space-y-2">
                    {blocks.map((b, i) => (
                      <AgentBlock key={i} block={b} />
                    ))}
                    {actions.map((a, i) => (
                      <ActionView
                        key={i}
                        action={a}
                        order={a.kind === "order_confirmation" ? ordersById.get(a.orderId) : undefined}
                        onDecide={decide}
                      />
                    ))}
                    {working && (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        {statusLabel && statusLabel.type === "status" ? statusLabel.label : "Working on it"}…
                      </p>
                    )}
                    {(m.status === "failed" || failed) && (
                      <p className="text-sm text-destructive">
                        {m.error || (failed && failed.type === "error" ? failed.message : "Failed")}
                      </p>
                    )}
                    {isLive && events.length > 0 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Raw events ({events.length})</summary>
                        <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2">
                          {events.map((e) => JSON.stringify(e)).join("\n")}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="flex gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              className="resize-none"
              placeholder="Message the agent as this user…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button type="submit" disabled={Boolean(live)}>
              Send
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
