import { after } from "next/server";

import { dispatchJob } from "@/lib/cursor";
import { createJob, listJobsForUser, patchJob } from "@/lib/jobs";
import { ensurePersonalRepo } from "@/lib/github";
import type { PersonalUser } from "@/lib/types";
import { canUseAgent } from "@/lib/workspaces";

const ACTIVE = new Set(["queued", "dispatched", "delivering"]);

/** Create a web-chat job and dispatch the user's standing Cursor agent. */
export async function enqueueWebChat(input: {
  user: PersonalUser;
  text: string;
  webThreadId?: string;
}) {
  const text = input.text.trim();
  if (!text) throw new Error("Message required");
  if (!canUseAgent(input.user)) {
    throw new Error(
      input.user.membershipStatus === "pending"
        ? "Your account is waiting for approval."
        : "Your agent is not available.",
    );
  }
  const recent = await listJobsForUser(input.user.id, 5);
  if (recent.some((j) => ACTIVE.has(j.status))) {
    throw new Error("Your agent is still working on the previous message.");
  }

  const webThreadId = input.webThreadId || "main";
  let user = input.user;
  try {
    user = await ensurePersonalRepo(user);
  } catch {
    // dispatch also ensures
  }

  const job = await createJob({
    ownerUserId: user.id,
    source: "web",
    webThreadId,
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
