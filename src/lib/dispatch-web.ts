import { after } from "next/server";

import { dispatchJob } from "@/lib/cursor";
import { createJob, findJobByClientSendId, patchJob } from "@/lib/jobs";
import { releaseThreadForNewMessage } from "@/lib/settle";
import { resolveAttachments } from "@/lib/files";
import { ensurePersonalRepo } from "@/lib/github";
import type { JobSource, PersonalUser } from "@/lib/types";
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
      // Ensure dispatch still runs if the first attempt died before after().
      if (!existing.cursorRunId && existing.status === "queued") {
        after(async () => {
          try {
            await dispatchJob(input.user, existing);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            await patchJob(existing.id, input.user.id, {
              status: "error",
              error: detail,
              event: { type: "error", detail },
            });
          }
        });
      }
      return { job: existing, user: input.user, reused: true as const };
    }
  }

  await releaseThreadForNewMessage(input.user.id, input.source, threadId);

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

  after(async () => {
    try {
      await dispatchJob(user, job);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await patchJob(job.id, user.id, {
        status: "error",
        error: detail,
        event: { type: "error", detail },
      });
    }
  });

  return { job, user, reused: false as const };
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
