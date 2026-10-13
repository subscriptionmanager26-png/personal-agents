import { NextResponse } from "next/server";

import { clientTrace } from "@/lib/client-text";
import { getAgentV1, openRunStream } from "@/lib/cursor-api";
import { runtimeForUserId } from "@/lib/runtime";
import { getOwnedJob } from "@/lib/job-access";
import { patchJob } from "@/lib/jobs";
import { isMockRunId, mockScript } from "@/lib/mock-trace";
import { settleJob } from "@/lib/settle";
import { encodeSse, parseSse, toTraceEvent } from "@/lib/trace";
import type { TraceEvent } from "@/lib/trace-types";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isSettled(job: Job) {
  return job.status === "replied" || job.status === "error";
}

async function onRunResult(job: Job, event: Extract<TraceEvent, { type: "result" }>) {
  if (isSettled(job)) return;
  if (event.status.toUpperCase() === "FINISHED") {
    await settleJob(job.id, job.ownerUserId, event.text ? { message: event.text } : undefined);
  } else {
    await patchJob(job.id, job.ownerUserId, {
      status: "error",
      error: `Agent run ended with status ${event.status}`,
      event: { type: "error", detail: `Run ${event.status}` },
    });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getOwnedJob(id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const lastEventId =
    request.headers.get("last-event-id") ||
    new URL(request.url).searchParams.get("lastEventId") ||
    undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TraceEvent, eventId?: string) =>
        controller.enqueue(encoder.encode(encodeSse(clientTrace(event), eventId)));
      const finish = () => {
        send({ type: "done" });
        controller.close();
      };

      try {
        if (isMockRunId(job.cursorRunId)) {
          const script = mockScript(job.id, job.prompt);
          const resumeAt = lastEventId
            ? script.findIndex((e) => e.id === lastEventId) + 1
            : 0;
          const instant = isSettled(job);
          for (let i = Math.max(resumeAt, 0); i < script.length; i++) {
            if (request.signal.aborted) return;
            if (!instant) await sleep(script.delays[i]);
            const event = toTraceEvent(script[i]);
            if (event && event.type !== "done") send(event, script[i].id);
          }
          return finish();
        }

        if (!job.cursorAgentId) {
          // Not dispatched yet: ask the browser to reconnect shortly.
          controller.enqueue(encoder.encode("retry: 2000\n\n"));
          send({ type: "status", status: job.status === "error" ? "ERROR" : "QUEUED" });
          if (job.status === "error") return finish();
          return controller.close();
        }

        const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
        let runId = job.cursorRunId;
        if (!runId) {
          const agent = await getAgentV1(key, job.cursorAgentId).catch(() => undefined);
          runId = agent?.latestRunId;
        }
        if (!runId) {
          send({ type: "error", message: "No run trace is available for this message." });
          return finish();
        }

        const upstream = await openRunStream(key, job.cursorAgentId, runId, {
          lastEventId,
          signal: request.signal,
        });
        if (upstream.status === 410) {
          send({ type: "expired" });
          return finish();
        }
        if (!upstream.ok || !upstream.body) {
          send({ type: "error", message: `Cursor stream HTTP ${upstream.status}` });
          return finish();
        }

        for await (const raw of parseSse(upstream.body)) {
          if (raw.event === "heartbeat") {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            continue;
          }
          const event = toTraceEvent(raw);
          if (!event) continue;
          if (event.type === "done") return finish();
          if (event.type === "result") await onRunResult(job, event);
          send(event, raw.id);
        }
        controller.close();
      } catch (error) {
        if (request.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        try {
          send({ type: "error", message: message.slice(0, 300) });
          finish();
        } catch {
          // controller already closed
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
