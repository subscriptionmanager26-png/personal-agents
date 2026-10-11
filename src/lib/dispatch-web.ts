import { after } from "next/server";

import { dispatchJob } from "@/lib/cursor";
import { createJob, findThreadJob, patchJob } from "@/lib/jobs";
import { ensurePersonalRepo } from "@/lib/github";
import type { PersonalUser } from "@/lib/types";

/** Create a web-chat job and dispatch the user's standing Cursor agent. */
export async function enqueueWebChat(input: {
  user: PersonalUser;
  text: string;
  webThreadId?: string;
}) {
  const text = input.text.trim();
  if (!text) throw new Error("Message required");

  const webThreadId = input.webThreadId || "main";
  let user = input.user;
  try {
    user = await ensurePersonalRepo(user);
  } catch {
    // dispatch also ensures
  }

  const prior = await findThreadJob(user.id, "web", webThreadId);
  const job = await createJob({
    ownerUserId: user.id,
    source: "web",
    webThreadId,
    prompt: text,
    threadContext: prior
      ? `Prior job ${prior.id} status=${prior.status}`
      : undefined,
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
