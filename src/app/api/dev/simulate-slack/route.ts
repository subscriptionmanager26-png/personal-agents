import { NextResponse } from "next/server";

import { handleSlackEnvelope } from "@/lib/handle-slack";

/**
 * Local-only helper to exercise Slack → personal agent without a real workspace.
 * Disabled when NODE_ENV=production.
 */
export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_LOGIN !== "true"
  ) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const body = (await request.json()) as {
    teamId?: string;
    userId?: string;
    channel?: string;
    text?: string;
    displayName?: string;
  };
  const teamId = body.teamId || "T_LOCAL";
  const userId = body.userId || "U_LOCAL";
  const channel = body.channel || "C_LOCAL";
  const ts = `${Date.now() / 1000}`;

  // Seed env bot token path by skipping install check via empty SLACK — handle-slack
  // still works if SLACK_BOT_TOKEN unset; postSlackMessage will fail — wrap mock.
  process.env.SLACK_BOT_TOKEN ||= "xoxb-mock-local";

  // Monkey-patch: use a soft mock by temporarily stubbing fetch for chat.postMessage
  // is heavy — instead call core path pieces if posting fails. For local UX we catch.
  try {
    const result = await handleSlackEnvelope({
      type: "event_callback",
      team_id: teamId,
      event: {
        type: "app_mention",
        user: userId,
        text: `<@BOT> ${body.text || "hello from local simulate"}`,
        ts,
        channel,
        channel_type: "channel",
        team: teamId,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
