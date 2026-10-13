import { getJob, listJobsForUser } from "@/lib/jobs";
import { listOrders } from "@/lib/orders";
import type { ActionRequired, Job, JobAttachment, OrderProposal, StreamEvent, UiBlock } from "@/lib/types";

const THREAD_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function isValidThreadId(id: string) {
  return THREAD_ID.test(id);
}

export type MessageView = {
  id: string;
  threadId: string;
  text: string;
  attachments: JobAttachment[];
  status: "working" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  blocks: UiBlock[];
  actions: ActionRequired[];
  error?: string;
};

function viewStatus(job: Job): MessageView["status"] {
  if (job.status === "replied") return "completed";
  if (job.status === "error") return "failed";
  return "working";
}

/** The public shape of one message: what the user sent and everything the agent showed. */
export function messageView(job: Job): MessageView {
  const stream = job.stream ?? [];
  return {
    id: job.id,
    threadId: job.webThreadId ?? "main",
    text: job.prompt,
    attachments: job.attachments ?? [],
    status: viewStatus(job),
    createdAt: job.createdAt,
    completedAt: job.status === "replied" ? job.reply?.receivedAt : undefined,
    blocks: stream.flatMap((e) => (e.type === "block" ? [e.block] : [])),
    actions: stream.flatMap((e) => (e.type === "action_required" ? [e.action] : [])),
    error: job.status === "error" ? job.error : undefined,
  };
}

export async function listMessages(ownerUserId: string, opts: { threadId?: string; limit?: number; source: Job["source"] }) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const jobs = (await listJobsForUser(ownerUserId, 1000)).filter(
    (j) => j.source === opts.source && (!opts.threadId || (j.webThreadId ?? "main") === opts.threadId),
  );
  return jobs.slice(0, limit).map(messageView);
}

export async function getOwnedMessage(ownerUserId: string, messageId: string) {
  const job = await getJob(messageId);
  return job && job.ownerUserId === ownerUserId ? job : undefined;
}

export function orderView(o: OrderProposal) {
  return {
    id: o.id,
    messageId: o.jobId,
    status: o.status,
    order: o.order,
    rationale: o.rationale,
    brokerOrderId: o.brokerOrderId,
    message: o.outcomeMessage,
    createdAt: o.createdAt,
    decidedAt: o.decidedAt,
  };
}

export async function listOrderViews(ownerUserId: string) {
  return (await listOrders(ownerUserId)).map(orderView);
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const POLL_MS = 700;
const HEARTBEAT_MS = 15_000;
/** Close before the platform's function limit; clients resume with Last-Event-ID. */
const MAX_STREAM_MS = 270_000;
const RUN_CHECK_MS = 5_000;

function encode(event: StreamEvent) {
  const { seq, ...rest } = event;
  return `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify({ seq, ...rest })}\n\n`;
}

/**
 * Server-sent events for one message, replayed from `after` (or Last-Event-ID).
 * Ends after `done` or `error`.
 */
export function messageEventStream(request: Request, ownerUserId: string, messageId: string) {
  const url = new URL(request.url);
  const resumeFrom = Number(request.headers.get("last-event-id") || url.searchParams.get("after") || 0) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = resumeFrom;
      const started = Date.now();
      let lastRunCheck = Date.now();
      let lastWrite = Date.now();
      const write = (text: string) => {
        controller.enqueue(encoder.encode(text));
        lastWrite = Date.now();
      };
      write("retry: 2000\n\n");
      try {
        while (!request.signal.aborted) {
          const job = await getJob(messageId);
          if (!job || job.ownerUserId !== ownerUserId) {
            write(`event: error\ndata: ${JSON.stringify({ type: "error", message: "message not found" })}\n\n`);
            break;
          }
          const fresh = (job.stream ?? []).filter((e) => e.seq > sent);
          for (const event of fresh) {
            write(encode(event));
            sent = event.seq;
          }
          if (fresh.some((e) => e.type === "done" || e.type === "error")) break;
          if ((job.stream ?? []).some((e) => e.seq <= sent && (e.type === "done" || e.type === "error"))) break;
          if (Date.now() - started > MAX_STREAM_MS) break;
          // Nothing else watches API runs, so check Cursor while the caller is listening.
          if (Date.now() - lastRunCheck > RUN_CHECK_MS) {
            lastRunCheck = Date.now();
            const { settleIfFinished } = await import("@/lib/settle");
            await settleIfFinished(job).catch(() => undefined);
          }
          if (Date.now() - lastWrite > HEARTBEAT_MS) write(": heartbeat\n\n");
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch {
        // client went away or store hiccup; the client resumes from its last id
      }
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
