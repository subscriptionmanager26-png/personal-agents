"use client";

import { PanelRight, Terminal, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TopBar } from "@/components/app-frame";
import { AssistantMessage, UserMessage } from "@/components/chat/messages";
import { Composer } from "@/components/composer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MessageView, orderView } from "@/lib/agent-api";
import type { ChatMessage } from "@/lib/threads";
import type { StreamEvent } from "@/lib/types";

type OrderView = ReturnType<typeof orderView>;
type Live = { messageId: string; events: StreamEvent[] };
type LogEntry = { messageId: string; event: StreamEvent };

const EVENT_TYPES = ["status", "block", "action_required", "done", "error"] as const;

const EVENT_TONE: Record<StreamEvent["type"], string> = {
  status: "text-info",
  block: "text-success",
  action_required: "text-warning",
  done: "text-muted-foreground",
  error: "text-destructive",
};

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body as T;
}

const GENERIC_STEPS = new Set(["Queued", "Working on it"]);

function stepsOf(events: StreamEvent[]) {
  const labels = events.flatMap((e) => (e.type === "status" ? [e.label.replace(/…$/, "")] : []));
  return [...new Set(labels.filter((l) => !GENERIC_STEPS.has(l)))];
}

function toChatMessage(m: MessageView, log: LogEntry[], live?: Live): ChatMessage {
  if (!live) return { ...m, steps: stepsOf(log.filter((l) => l.messageId === m.id).map((l) => l.event)) };
  const events = live.events;
  const failed = events.find((e) => e.type === "error");
  const finished = events.some((e) => e.type === "done");
  return {
    ...m,
    blocks: events.flatMap((e) => (e.type === "block" ? [e.block] : [])),
    actions: events.flatMap((e) => (e.type === "action_required" ? [e.action] : [])),
    steps: stepsOf(events),
    status: failed ? "failed" : finished ? "completed" : "working",
    error: failed?.type === "error" ? failed.message : undefined,
    completedAt: finished ? events[events.length - 1].at : undefined,
  };
}

function eventSummary(e: StreamEvent) {
  switch (e.type) {
    case "status":
      return e.label;
    case "block":
      return e.block.kind === "markdown" ? e.block.text.slice(0, 80) : `${e.block.kind}${"title" in e.block && e.block.title ? ` · ${e.block.title}` : ""}`;
    case "action_required":
      if (e.action.kind === "order_confirmation") {
        return `order · ${e.action.order.side} ${e.action.order.quantity} ${e.action.order.symbol}`;
      }
      if (e.action.kind === "portfolio_confirmation") {
        return `portfolio · ${e.action.mode} ${e.action.holdings.length} lines`;
      }
      return `login · ${e.action.service}`;
    case "error":
      return e.message;
    default:
      return "";
  }
}

function EventsPanel({ log }: { log: LogEntry[] }) {
  const [openSeq, setOpenSeq] = useState<string>();
  return (
    <aside className="sticky top-12 hidden h-[calc(100svh-3rem)] w-96 shrink-0 flex-col border-l bg-sidebar lg:flex">
      <div className="flex h-10 items-center gap-2 border-b px-3 text-xs font-medium text-muted-foreground">
        <Terminal className="size-3.5" />
        Event stream
        <span className="ml-auto font-mono">{log.length}</span>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-2 font-mono text-xs">
        {!log.length && (
          <p className="p-2 font-sans leading-relaxed text-muted-foreground">
            Server-sent events from <code>GET /api/v1/users/:id/messages/:mid/events</code> appear here as the agent works.
          </p>
        )}
        {log.map(({ messageId, event }) => {
          const key = `${messageId}:${event.seq}`;
          const open = openSeq === key;
          return (
            <div key={key} className="rounded-md hover:bg-muted/40">
              <button
                type="button"
                onClick={() => setOpenSeq(open ? undefined : key)}
                className="flex w-full items-center gap-2 px-2 py-1 text-left"
              >
                <span className="w-6 shrink-0 text-right text-muted-foreground/60">{event.seq}</span>
                <span className={`shrink-0 ${EVENT_TONE[event.type]}`}>{event.type}</span>
                <span className="min-w-0 truncate text-muted-foreground">{eventSummary(event)}</span>
              </button>
              {open && (
                <pre className="mx-2 mb-2 max-h-72 overflow-auto rounded-md border bg-background p-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {JSON.stringify(event, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function ConsoleClient({ knownUsers, suggestions }: { knownUsers: string[]; suggestions: string[] }) {
  const [userId, setUserId] = useState(knownUsers[0] ?? "user_1001");
  const [name, setName] = useState("");
  const [active, setActive] = useState<string>();
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [live, setLive] = useState<Live>();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showEvents, setShowEvents] = useState(true);
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
  useEffect(() => {
    const scroller = bottomRef.current?.closest<HTMLElement>("[data-scroll-root]");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages, live]);

  const openUser = async (id = userId.trim()) => {
    setError("");
    try {
      await json(
        await fetch("/app/console/api/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalId: id, name: name.trim() || undefined }),
        }),
      );
      sourceRef.current?.close();
      setLive(undefined);
      setLog([]);
      setActive(id);
      await refresh(id);
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
        setLog((cur) => [...cur, { messageId, event }]);
        if (type === "action_required") void refresh();
        if (type === "done" || type === "error") {
          es.close();
          void refresh().then(() => setLive(undefined));
        }
      });
    }
  };

  const send = async (text: string, attachments: string[]) => {
    if (!active) return false;
    setError("");
    try {
      const { message } = await json<{ message: MessageView }>(
        await fetch("/app/console/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: active, text, attachments }),
        }),
      );
      setMessages((m) => [...m, message]);
      listen(message.id);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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

  const orderStates = Object.fromEntries(orders.map((o) => [o.id, { status: o.status, brokerOrderId: o.brokerOrderId }]));

  const picker = (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void openUser();
      }}
    >
      <div className="relative">
        <UserRound className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          list="known-users"
          aria-label="User id"
          className="h-8 w-40 pl-7 font-mono text-xs"
        />
      </div>
      <datalist id="known-users">
        {knownUsers.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <Button type="submit" size="sm" variant={active === userId.trim() ? "ghost" : "secondary"}>
        {active ? "Switch" : "Open"}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className={`hidden text-muted-foreground lg:inline-flex ${showEvents ? "bg-muted text-foreground" : ""}`}
              aria-label="Toggle event stream"
              onClick={() => setShowEvents((v) => !v)}
            />
          }
        >
          <PanelRight />
        </TooltipTrigger>
        <TooltipContent>Event stream</TooltipContent>
      </Tooltip>
    </form>
  );

  return (
    <div className="flex min-h-full shrink-0 flex-col">
      <TopBar
        title={
          <span className="flex items-center gap-2">
            Console
            {active && <span className="truncate font-mono text-xs font-normal text-muted-foreground">as {active}</span>}
          </span>
        }
      >
        {picker}
      </TopBar>
      <div className="flex flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {!active ? (
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 pb-[12vh]">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Open a user&apos;s agent</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Act as your app: pick one of your users and see exactly what the API streams. This rendering is
                  only a reference; your UI decides how each block looks.
                </p>
              </div>
              <form
                className="space-y-3 rounded-xl border bg-card p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void openUser();
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor="console-user" className="text-xs text-muted-foreground">
                    User id in your system
                  </label>
                  <Input id="console-user" value={userId} onChange={(e) => setUserId(e.target.value)} list="known-users" className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="console-name" className="text-xs text-muted-foreground">
                    Display name (optional)
                  </label>
                  <Input id="console-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" />
                </div>
                <Button type="submit" className="w-full">
                  Open agent
                </Button>
              </form>
              {knownUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {knownUsers.slice(0, 6).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => {
                        setUserId(u);
                        void openUser(u);
                      }}
                      className="rounded-full border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          ) : (
            <>
              <div className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 pt-8 pb-10">
                {!messages.length && (
                  <div className="pt-[10vh] text-center">
                    <h2 className="text-xl font-semibold tracking-tight">No messages yet</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Send a message as <span className="font-mono">{active}</span> to start their agent.
                    </p>
                  </div>
                )}
                {messages.map((m) => {
                  const message = toChatMessage(m, log, live?.messageId === m.id ? live : undefined);
                  return (
                    <section key={m.id} className="space-y-5">
                      <UserMessage text={m.text} attachments={m.attachments ?? []} />
                      <AssistantMessage message={message} orders={orderStates} onDecide={decide} />
                    </section>
                  );
                })}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div ref={bottomRef} />
              </div>
              <div className="sticky bottom-0 z-10 bg-linear-to-t from-background from-70% to-transparent px-4 pt-6 pb-4">
                <div className="mx-auto max-w-3xl">
                  <Composer
                    key={active}
                    uploadUrl={`/app/console/api/files?user=${encodeURIComponent(active)}`}
                    onSend={send}
                    disabled={Boolean(live)}
                    autoFocus
                    suggestions={messages.length ? undefined : suggestions}
                    placeholder={`Message as ${active}, or attach a PDF, CSV or Excel file…`}
                    hint={messages.length ? undefined : "Your app uploads files with POST /api/v1/users/:id/files."}
                  />
                </div>
              </div>
            </>
          )}
        </div>
        {showEvents && <EventsPanel log={log} />}
      </div>
    </div>
  );
}
