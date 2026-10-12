import { after } from "next/server";

import { dispatchJob } from "@/lib/cursor";
import { createJob, findThreadJob, markSlackMessageProcessed } from "@/lib/jobs";
import {
  fetchSlackUser,
  postSlackMessage,
  stripBotMention,
} from "@/lib/slack";
import { deactivateSlackInstall, getSlackInstall } from "@/lib/slack-install";
import { ensurePersonalRepo } from "@/lib/github";
import { upsertUserFromSlack } from "@/lib/users";

type SlackEvent = {
  type?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  bot_id?: string;
  subtype?: string;
  team?: string;
};

export async function handleSlackEnvelope(body: {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: SlackEvent;
  event_id?: string;
}) {
  if (body.type === "url_verification") {
    return { challenge: body.challenge };
  }

  const event = body.event;
  if (!event) return { ok: true };

  if (event.type === "app_uninstalled") {
    if (body.team_id) await deactivateSlackInstall(body.team_id);
    return { ok: true };
  }

  if (event.bot_id || event.subtype === "bot_message") {
    return { ok: true };
  }

  const teamId = event.team || body.team_id;
  if (!teamId || !event.user || !event.channel || !event.ts) {
    return { ok: true };
  }

  const isMention = event.type === "app_mention";
  const isMessage = event.type === "message";
  if (!isMention && !isMessage) return { ok: true };

  const isDm = event.channel_type === "im";
  const threadTs = event.thread_ts || event.ts;
  const text = stripBotMention(event.text || "");

  // In channels, require mention for top-level; thread replies of known jobs allowed
  if (!isDm && !isMention && !event.thread_ts) {
    return { ok: true };
  }

  const dedupeKey = `${teamId}:${event.channel}:${event.ts}`;
  const first = await markSlackMessageProcessed(dedupeKey);
  if (!first) return { ok: true, deduped: true };

  const profile = await fetchSlackUser({ teamId, userId: event.user });
  let user = await upsertUserFromSlack({
    teamId,
    userId: event.user,
    displayName: profile?.displayName,
    email: profile?.email,
    avatarUrl: profile?.avatarUrl,
  });

  // Thread follow-up without mention: only if this user owns the thread
  if (!isDm && !isMention && event.thread_ts) {
    const prior = await findThreadJob(user.id, event.channel, event.thread_ts);
    if (!prior) return { ok: true };
  }

  if (!text) {
    await postSlackMessage({
      teamId,
      channel: event.channel,
      threadTs,
      text: "Send a task after mentioning me (or reply in our thread).",
    });
    return { ok: true };
  }

  // Ensure install exists (or env bot token)
  const install = await getSlackInstall(teamId);
  if (!install && !process.env.SLACK_BOT_TOKEN) {
    return { ok: true, error: "workspace not installed" };
  }

  try {
    user = await ensurePersonalRepo(user);
  } catch {
    // dispatch path also ensures; continue
  }

  await postSlackMessage({
    teamId,
    channel: event.channel,
    threadTs,
    text: `On it — personal agent for ${user.displayName || user.email || user.slackUserId}.`,
  });

  const job = await createJob({
    ownerUserId: user.id,
    source: "slack",
    slackTeamId: teamId,
    slackChannelId: event.channel,
    slackThreadTs: threadTs,
    slackUserId: event.user,
    slackMessageTs: event.ts,
    prompt: text,
  });

  // Keep the serverless invocation alive after the HTTP response (Vercel/Next).
  after(async () => {
    try {
      await dispatchJob(user, job);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await postSlackMessage({
        teamId,
        channel: event.channel!,
        threadTs,
        text: `Could not start your personal agent: ${detail.slice(0, 500)}`,
      });
    }
  });

  return { ok: true, jobId: job.id, userId: user.id };
}
