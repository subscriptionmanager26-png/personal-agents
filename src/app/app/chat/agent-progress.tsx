"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";

import { WorkingSteps } from "@/components/chat/messages";
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

/** Live progress for a web message: the agent's own steps plus what the Cursor run is doing right now. */
export function AgentProgress({ jobId, startedAt, steps }: { jobId: string; startedAt: string; steps: string[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("Starting your agent…");

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

  return <WorkingSteps steps={steps} label={steps.length && label === "Starting your agent…" ? undefined : label} startedAt={startedAt} />;
}
