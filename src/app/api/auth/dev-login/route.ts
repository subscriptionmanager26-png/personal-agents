import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/request-origin";
import { redirectWithSession, sessionFromUser, setSessionCookie } from "@/lib/session";
import { registerUserWithEmail, authenticateEmailPassword } from "@/lib/users";

/**
 * Dev convenience login (email-based). Still gated by ALLOW_DEV_LOGIN in production.
 * Prefer the normal email signup/login forms on `/`.
 */
async function issueDevUser() {
  const email = "dev@local.test";
  const password = "dev-password-change-me";
  const existing = await authenticateEmailPassword({ email, password });
  if ("user" in existing) return existing.user;
  const created = await registerUserWithEmail({
    email,
    password,
    displayName: "Local Operator",
  });
  if ("user" in created) return created.user;
  // Password mismatch on an existing account — surface a clear error
  throw new Error(created.error);
}

function allowDevLogin() {
  return !(
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_LOGIN !== "true"
  );
}

export async function POST() {
  if (!allowDevLogin()) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const user = await issueDevUser();
  await setSessionCookie(sessionFromUser(user));
  return NextResponse.json({ ok: true, user });
}

export async function GET(request: Request) {
  if (!allowDevLogin()) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const user = await issueDevUser();
  return redirectWithSession(
    sessionFromUser(user),
    `${requestOrigin(request)}/app/chat`,
  );
}
