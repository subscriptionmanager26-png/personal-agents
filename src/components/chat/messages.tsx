"use client";

import { Check, ChevronRight, CircleAlert, Copy, ExternalLink, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AgentBlock } from "@/components/agent-blocks";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/file-limits";
import type { ChatMessage } from "@/lib/threads";
import type { ActionRequired, JobAttachment } from "@/lib/types";

export type OrderState = { status: string; brokerOrderId?: string };

function duration(from: string, to?: string) {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function AttachmentList({ attachments, className = "" }: { attachments: JobAttachment[]; className?: string }) {
  if (!attachments.length) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {attachments.map((a) => {
        const Icon = a.kind === "pdf" ? FileText : FileSpreadsheet;
        return (
          <span key={a.id} className="flex max-w-full items-center gap-2 rounded-lg border bg-background/60 py-1 pr-2.5 pl-1.5 text-xs">
            <span className={`flex size-6 items-center justify-center rounded-md ${a.kind === "pdf" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
              <Icon className="size-3.5" />
            </span>
            <span className="max-w-52 truncate font-medium">{a.name}</span>
            <span className="text-muted-foreground">{formatBytes(a.size)}</span>
          </span>
        );
      })}
    </div>
  );
}

export function UserMessage({ text, attachments }: { text: string; attachments: JobAttachment[] }) {
  return (
    <div className="rounded-xl border bg-muted/40 px-4 py-3">
      <AttachmentList attachments={attachments} className="mb-2.5" />
      <p className="text-[15px] leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

function Elapsed({ since }: { since: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="text-xs text-muted-foreground tabular-nums">{duration(since)}</span>;
}

/** Live progress: finished steps with checks, the current one shimmering. */
export function WorkingSteps({ steps, label, startedAt }: { steps: string[]; label?: string; startedAt: string }) {
  const done = label ? steps.filter((s) => s !== label) : steps.slice(0, -1);
  const current = label ?? steps[steps.length - 1] ?? "Thinking";
  return (
    <div role="status" aria-live="polite" className="space-y-1.5 text-sm">
      {done.map((s, i) => (
        <p key={`${s}-${i}`} className="flex items-center gap-2 text-muted-foreground">
          <Check className="size-3.5 text-success" />
          {s}
        </p>
      ))}
      <p className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        <span className="shimmer font-medium">{current.replace(/…$/, "")}</span>
        <Elapsed since={startedAt} />
      </p>
    </div>
  );
}

function StepsSummary({ steps, from, to }: { steps: string[]; from: string; to?: string }) {
  const label = `Worked for ${duration(from, to)}`;
  if (!steps.length) return <p className="text-xs text-muted-foreground">{label}</p>;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {label} · {steps.length} {steps.length === 1 ? "step" : "steps"}
        <ChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1.5 border-l pl-3">
        {steps.map((s, i) => (
          <p key={`${s}-${i}`} className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="size-3 text-success" />
            {s}
          </p>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          />
        }
      >
        {copied ? <Check /> : <Copy />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}

export function ActionCard({
  action,
  order,
  onDecide,
}: {
  action: ActionRequired;
  order?: OrderState;
  onDecide?: (orderId: string, decision: "confirm" | "reject") => void;
}) {
  if (action.kind === "connection_login") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Log in to {action.service}</p>
          {action.message && <p className="mt-0.5 text-sm text-muted-foreground">{action.message}</p>}
        </div>
        <a href={action.url} target="_blank" rel="noreferrer" className={buttonVariants()}>
          Log in
          <ExternalLink />
        </a>
      </div>
    );
  }
  const o = action.order;
  const status = order?.status ?? "proposed";
  const buy = o.side === "BUY";
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start gap-3 p-4">
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${buy ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
          {o.side}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {o.quantity} × {o.symbol}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {o.exchange} · {o.product === "CNC" ? "Delivery" : "Intraday"} ·{" "}
              {o.orderType === "LIMIT" ? `Limit ₹${o.price?.toLocaleString("en-IN")}` : "Market"}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{action.rationale}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-2.5">
        {status === "proposed" ? (
          onDecide ? (
            <>
              <span className="text-xs text-muted-foreground">Not placed until you confirm</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onDecide(action.orderId, "reject")}>
                  Reject
                </Button>
                <Button size="sm" onClick={() => onDecide(action.orderId, "confirm")}>
                  Confirm order
                </Button>
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Awaiting confirmation · not placed yet</span>
          )
        ) : (
          <span className={`text-xs font-medium ${status === "executed" ? "text-success" : "text-muted-foreground"}`}>
            {status === "executed" ? `Placed · broker id ${order?.brokerOrderId ?? "—"}` : status[0].toUpperCase() + status.slice(1)}
          </span>
        )}
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  live,
  orders,
  onDecide,
  children,
}: {
  message: ChatMessage;
  /** Replaces the progress line while the message is still working. */
  live?: ReactNode;
  orders?: Record<string, OrderState>;
  onDecide?: (orderId: string, decision: "confirm" | "reject") => void;
  children?: ReactNode;
}) {
  const working = message.status === "working";
  const copyText = message.blocks.flatMap((b) => (b.kind === "markdown" ? [b.text] : [])).join("\n\n");
  return (
    <div className="space-y-4">
      {working
        ? (live ?? <WorkingSteps steps={message.steps} startedAt={message.createdAt} />)
        : <StepsSummary steps={message.steps} from={message.createdAt} to={message.completedAt} />}
      {message.blocks.map((b, i) => (
        <AgentBlock key={i} block={b} />
      ))}
      {message.actions.map((a, i) => (
        <ActionCard
          key={i}
          action={a}
          order={a.kind === "order_confirmation" ? orders?.[a.orderId] : undefined}
          onDecide={onDecide}
        />
      ))}
      {message.status === "failed" && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {message.error || "The agent could not finish this message."}
        </div>
      )}
      {children}
      {!working && copyText && (
        <div className="-mt-2 flex">
          <CopyButton text={copyText} />
        </div>
      )}
    </div>
  );
}
