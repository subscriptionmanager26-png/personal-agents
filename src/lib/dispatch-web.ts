import { after } from "next/server";

import { dispatchJob } from "@/lib/cursor";
import { createJob, findJobByClientSendId, getJob, patchJob } from "@/lib/jobs";
import { releaseThreadForNewMessageDeferred, releaseThreadForNewMessageFast } from "@/lib/settle";
import { resolveAttachments } from "@/lib/files";
import { ensurePersonalRepo } from "@/lib/github";
import { tablesEnqueueDispatch, tablesMarkDispatchDone, tablesStoreEnabled } from "@/lib/store-tables";
import type { Job, JobSource, PersonalUser } from "@/lib/types";
import { canUseAgent } from "@/lib/workspaces";

export const MAX_MESSAGE_CHARS = 8000;

export class ChatRejected extends Error {
  constructor(
    message: string,
    readonly code: "not_allowed" | "busy" | "invalid",
  ) {
    super(message);
  }
}

/** Never await — keeps POST 202 at enqueue time, not dispatch time. */
function scheduleDispatch(user: PersonalUser, job: Job) {
  // Best-effort nudge — durable queue cron is primary when TABLES=1.
  // claimJobDispatch prevents duplicate createAgent if both race.
  after(async () => {
    if (tablesStoreEnabled()) {
      try {
        await tablesEnqueueDispatch(job.id, user.id);
      } catch (error) {
        console.error("[enqueueChat] queue insert failed", job.id, error);
      }
    }
    try {
      await dispatchJob(user, job);
      if (tablesStoreEnabled()) {
        await tablesMarkDispatchDone(job.id).catch(() => undefined);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[enqueueChat] dispatch failed", { jobId: job.id, detail });
      await patchJob(job.id, user.id, {
        status: "error",
        error: detail,
        event: { type: "error", detail },
      });
      if (tablesStoreEnabled()) {
        await tablesMarkDispatchDone(job.id).catch(() => undefined);
      }
    }
  });
}

/** Create a chat job and dispatch the user's standing Cursor agent in the background. */
export async function enqueueChat(input: {
  user: PersonalUser;
  text: string;
  threadId?: string;
  source: Exclude<JobSource, "slack">;
  /** Ids of the user's uploaded files. */
  attachments?: unknown;
  /** Client idempotency key — retries reuse the same job. */
  clientSendId?: string;
}) {
  const resolved = await resolveAttachments(input.user.id, input.attachments);
  if ("error" in resolved) throw new ChatRejected(resolved.error, "invalid");
  const text = input.text.trim() || (resolved.files.length ? "Please look at the attached file(s)." : "");
  if (!text) throw new ChatRejected("Message required", "invalid");
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new ChatRejected(`Message is longer than ${MAX_MESSAGE_CHARS} characters`, "invalid");
  }
  if (!canUseAgent(input.user)) {
    throw new ChatRejected(
      input.user.membershipStatus === "pending"
        ? "Your account is waiting for approval."
        : "Your agent is not available.",
      "not_allowed",
    );
  }
  const threadId = input.threadId || "main";
  const clientSendId = typeof input.clientSendId === "string" ? input.clientSendId.trim() : "";

  if (clientSendId) {
    const existing = await findJobByClientSendId({
      ownerUserId: input.user.id,
      source: input.source,
      webThreadId: threadId,
      clientSendId,
    });
    if (existing) {
      if (!existing.cursorRunId && existing.status === "queued") {
        scheduleDispatch(input.user, existing);
      }
      return { job: existing, user: input.user, reused: true as const };
    }
  }

  const { id: ownerUserId } = input.user;
  await releaseThreadForNewMessageFast(ownerUserId, input.source, threadId);

  let user = input.user;
  if (input.source === "web") {
    try {
      user = await ensurePersonalRepo(user);
    } catch {
      // dispatch also ensures
    }
  }

  const job = await createJob({
    ownerUserId: user.id,
    source: input.source,
    webThreadId: threadId,
    prompt: text,
    clientSendId: clientSendId || undefined,
    attachments: resolved.files.map(({ id, name, kind, size }) => ({ id, name, kind, size })),
  });

  after(() => {
    void releaseThreadForNewMessageDeferred(ownerUserId, input.source, threadId, {
      exceptJobId: job.id,
    }).catch((error) => {
      console.error("[enqueueChat] releaseThread deferred failed", {
        ownerUserId,
        threadId,
        exceptJobId: job.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  scheduleDispatch(user, job);

  return { job, user, reused: false as const };
}

/** Client-callable nudge — run dispatch in this request instead of waiting on after() / cron. */
export async function kickJobDispatch(
  user: PersonalUser,
  jobId: string,
): Promise<{ kicked: boolean; reason: string }> {
  const job = await getJob(jobId, { fresh: true });
  if (!job || job.ownerUserId !== user.id) return { kicked: false, reason: "not_found" };
  if (job.cursorRunId || job.status === "replied" || job.status === "error") {
    return { kicked: false, reason: "already_started" };
  }
  if (job.status !== "queued") {
    return { kicked: false, reason: job.status };
  }
  try {
    await Promise.race([
      dispatchJob(user, job),
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[kickJobDispatch] failed", { jobId, detail });
    return { kicked: false, reason: "dispatch_error" };
  }
  const row = (await getJob(jobId, { fresh: true })) ?? job;
  if (row.cursorRunId) return { kicked: true, reason: "run_started" };
  return { kicked: true, reason: "dispatch_started" };
}

export async function enqueueWebChat(input: {
  user: PersonalUser;
  text: string;
  webThreadId?: string;
  attachments?: string[];
}) {
  return enqueueChat({
    user: input.user,
    text: input.text,
    threadId: input.webThreadId,
    source: "web",
    attachments: input.attachments,
  });
}
