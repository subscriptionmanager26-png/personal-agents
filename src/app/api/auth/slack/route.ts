import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { requestOrigin } from "@/lib/request-origin";
import { beginUserSignIn } from "@/lib/slack-oauth";

export async function GET(request: Request) {
  const base = requestOrigin(request);
  const cfg = getConfig();
  if (!cfg.slackClientId || !cfg.slackClientSecret || !cfg.publicUrl) {
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(
        "Slack sign-in needs SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and PUBLIC_URL.",
      )}`,
    );
  }
  try {
    const url = await beginUserSignIn();
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(message)}`,
    );
  }
}
