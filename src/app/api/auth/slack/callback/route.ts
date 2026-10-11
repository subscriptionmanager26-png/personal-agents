import { NextResponse } from "next/server";

import { ensurePersonalRepo } from "@/lib/github";
import { requestOrigin } from "@/lib/request-origin";
import { redirectWithSession, sessionFromUser } from "@/lib/session";
import { finishUserSignIn } from "@/lib/slack-oauth";
import { upsertUserFromSlack } from "@/lib/users";

/** Optional Slack sign-in — email auth is the primary path. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const err = searchParams.get("error");
  const base = requestOrigin(request);

  if (err) {
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(err)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${base}/?error=missing_code`);
  }

  try {
    const identity = await finishUserSignIn({ code, state });
    const user = await upsertUserFromSlack({
      teamId: identity.teamId,
      userId: identity.userId,
      displayName: identity.displayName,
      email: identity.email,
      avatarUrl: identity.avatarUrl,
    });
    void ensurePersonalRepo(user).catch(() => undefined);
    return redirectWithSession(sessionFromUser(user), `${base}/app/chat`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.redirect(
      `${base}/?error=${encodeURIComponent(message)}`,
    );
  }
}
