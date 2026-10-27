import { clientAction, clientBlock, clientError, clientStreamEvent, clientText } from "@/lib/client-text";
import { getJob, sortedJobsForUser } from "@/lib/jobs";
import { getStore } from "@/lib/store";
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
  const stream = job.stream ?? [];
  if (stream.some((e) => e.type === "done")) return "completed";
  if (stream.some((e) => e.type === "error")) return "failed";
  return "working";
}

/** UI blocks: stream cards/tables plus the full assistant reply (stream often only has a prefix). */
export function blocksForJob(job: Job): UiBlock[] {
  const fromStream = (job.stream ?? []).flatMap((e) => (e.type === "block" ? [clientBlock(e.block)] : []));
  const rich = fromStream.filter((b) => b.kind !== "markdown");
  const streamMd = fromStream
    .filter((b): b is { kind: "markdown"; text: string } => b.kind === "markdown")
    .map((b) => b.text)
    .join("\n\n");
  const replyText = job.reply?.message?.trim();
  const stream = job.stream ?? [];
  const terminal =
    job.status === "replied" ||
    job.status === "error" ||
    stream.some((e) => e.type === "done" || e.type === "error");

  if (terminal && (replyText || streamMd)) {
    const best =
      replyText && replyText.length >= streamMd.length
        ? clientText(replyText)
        : streamMd || (replyText ? clientText(replyText) : "");
    if (best) {
      const md = { kind: "markdown" as const, text: best };
      return rich.length ? [md, ...rich] : [md];
    }
  }

  if (!fromStream.length && replyText) {
    return [{ kind: "markdown", text: clientText(replyText) }];
  }

  return fromStream;
}

/** The public shape of one message: what the user sent and everything the agent showed. */
export function messageView(job: Job): MessageView {
  const stream = job.stream ?? [];
  const completedAt =
    job.status === "replied"
      ? job.reply?.receivedAt
      : stream.find((e) => e.type === "done")?.at;
  return {
    id: job.id,
    threadId: job.webThreadId ?? "main",
    text: job.prompt,
    attachments: job.attachments ?? [],
    status: viewStatus(job),
    createdAt: job.createdAt,
    completedAt,
    blocks: blocksForJob(job),
    actions: stream.flatMap((e) => (e.type === "action_required" ? [clientAction(e.action)] : [])),
    error: job.status === "error" ? clientError(job.error) : undefined,
  };
}

function safeMessageView(job: Job): MessageView {
  try {
    return messageView(job);
  } catch {
    return {
      id: job.id,
      threadId: job.webThreadId ?? "main",
      text: job.prompt ?? "",
      attachments: job.attachments ?? [],
      status: viewStatus(job),
      createdAt: job.createdAt,
      completedAt: job.status === "replied" ? job.reply?.receivedAt : undefined,
      blocks: [],
      actions: [],
      error: job.status === "error" ? clientError(job.error) : undefined,
    };
  }
}

const ACTIVE_MESSAGE = new Set(["queued", "dispatched", "delivering"]);

export async function listMessages(ownerUserId: string, opts: { threadId?: string; limit?: number; source: Job["source"] }) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const store = await getStore();
  const scanCap = opts.threadId ? 400 : 250;
  const out: MessageView[] = [];
  let examined = 0;
  const { reconcileJob, reconcileErroredJob, ensureFullReply } = await import("@/lib/settle");
  const rows: Job[] = [];
  for (const job of sortedJobsForUser(store, ownerUserId)) {
    examined += 1;
    if (examined > scanCap) break;
    if (job.source !== opts.source) continue;
    if (opts.threadId && (job.webThreadId ?? "main") !== opts.threadId) continue;
    let row = ACTIVE_MESSAGE.has(job.status) ? await reconcileJob(job) : job;
    if (row.status === "replied") row = await ensureFullReply(row);
    rows.push(row);
    if (rows.length >= limit) break;
  }
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].status === "error") rows[i] = await reconcileErroredJob(rows[i], rows);
    if (rows[i].status === "replied") rows[i] = await ensureFullReply(rows[i]);
    out.push(safeMessageView(rows[i]));
  }
  return out;
}

export async function getOwnedMessage(ownerUserId: string, messageId: string) {
  const job = await getJob(messageId, { fresh: true });
  if (!job || job.ownerUserId !== ownerUserId) return undefined;
  const { reconcileJob, reconcileErroredJob, ensureFullReply } = await import("@/lib/settle");
  let row = await reconcileJob(job);
  if (row.status === "error") {
    const peers = sortedJobsForUser(await getStore(), ownerUserId).filter(
      (j) => j.source === row.source && (j.webThreadId ?? "main") === (row.webThreadId ?? "main"),
    );
    row = await reconcileErroredJob(row, peers);
  }
  if (row.status === "replied") row = await ensureFullReply(row);
  return row;
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
          const job = await getJob(messageId, { fresh: true });
          if (!job || job.ownerUserId !== ownerUserId) {
            write(`event: error\ndata: ${JSON.stringify({ type: "error", message: "message not found" })}\n\n`);
            break;
          }
          const fresh = (job.stream ?? []).filter((e) => e.seq > sent);
          for (const event of fresh) {
            write(encode(clientStreamEvent(event)));
            sent = event.seq;
          }
          const terminalInStream = (job.stream ?? []).some((e) => e.type === "done" || e.type === "error");
          if (fresh.some((e) => e.type === "done" || e.type === "error")) break;
          if (terminalInStream && sent >= (job.stream ?? []).find((e) => e.type === "done" || e.type === "error")!.seq) {
            break;
          }
          if (job.status === "replied") {
            const alreadySentDone = (job.stream ?? []).some((e) => e.type === "done" && e.seq <= sent);
            if (!alreadySentDone) {
              write(`event: done\ndata: ${JSON.stringify({ type: "done", at: job.reply?.receivedAt })}\n\n`);
            }
            break;
          }
          if (job.status === "error") {
            write(
              `event: error\ndata: ${JSON.stringify({ type: "error", message: job.error || "The agent could not finish." })}\n\n`,
            );
            break;
          }
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
