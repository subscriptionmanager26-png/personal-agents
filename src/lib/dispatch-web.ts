import { after } from "next/server";

import { dispatchJob } from "@/lib/cursor";
import { createJob, listJobsForUser, patchJob } from "@/lib/jobs";
import { ensurePersonalRepo } from "@/lib/github";
import type { JobSource, PersonalUser } from "@/lib/types";
import { canUseAgent } from "@/lib/workspaces";

const ACTIVE = new Set(["queued", "dispatched", "delivering"]);
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
}) {
  const text = input.text.trim();
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
  const recent = await listJobsForUser(input.user.id, 5);
  if (recent.some((j) => ACTIVE.has(j.status))) {
    throw new ChatRejected("Your agent is still working on the previous message.", "busy");
  }

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
    webThreadId: input.threadId || "main",
    prompt: text,
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

  return { job, user };
}

export async function enqueueWebChat(input: { user: PersonalUser; text: string; webThreadId?: string }) {
  return enqueueChat({ user: input.user, text: input.text, threadId: input.webThreadId, source: "web" });
}
