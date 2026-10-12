"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import type { TraceEvent } from "@/lib/trace-types";

function labelFor(event: TraceEvent | undefined): string | undefined {
  if (!event) return undefined;
  switch (event.type) {
    case "status":
      return event.status === "QUEUED" || event.status === "CREATING" ? "Starting your agent…" : undefined;
    case "thinking":
      return "Thinking…";
    case "assistant":
      return "Writing the reply…";
    case "tool":
      switch (event.kind) {
        case "terminal":
          return "Running commands…";
        case "file":
          return event.file?.action === "Read" ? "Reading files…" : "Writing files…";
        case "browser":
          return "Using the browser…";
        case "vault":
          return "Signing in with your vault…";
        case "search":
          return "Searching…";
        case "mcp":
          return "Using a connected tool…";
        default:
          return "Working…";
      }
    default:
      return undefined;
  }
}

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AgentProgress({ jobId, startedAt }: { jobId: string; startedAt: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("Starting your agent…");
  const [elapsed, setElapsed] = useState("");

  const onFinished = useEffectEvent(() => router.refresh());

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as TraceEvent;
      const next = labelFor(event);
      if (next) setLabel(next);
      if (event.type === "result" || event.type === "done") {
        source.close();
        onFinished();
      }
    };
    return () => source.close();
  }, [jobId]);

  useEffect(() => {
    const start = Date.parse(startedAt);
    const tick = () => setElapsed(formatElapsed(Date.now() - start));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [startedAt]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="mr-auto flex w-fit max-w-[85%] items-center gap-2 rounded-2xl rounded-bl-md border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 shrink-0 animate-spin" />
      <span>{label}</span>
      {elapsed && <span className="tabular-nums text-xs opacity-70">{elapsed}</span>}
    </div>
  );
}
