import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { requestOrigin } from "@/lib/request-origin";
import { beginWorkspaceInstall } from "@/lib/slack-oauth";

export async function GET(request: Request) {
  const base = requestOrigin(request);
  const cfg = getConfig();
  if (!cfg.slackClientId || !cfg.slackClientSecret || !cfg.publicUrl) {
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(
        "Slack install needs SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and PUBLIC_URL (http://127.0.0.1:43149 locally).",
      )}`,
    );
  }
  try {
    const url = await beginWorkspaceInstall();
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(message)}`,
    );
  }
}
