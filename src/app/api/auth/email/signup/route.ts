import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/request-origin";
import { redirectWithSession, sessionFromUser } from "@/lib/session";
import { registerUserWithEmail } from "@/lib/users";
import { ensurePersonalRepo } from "@/lib/github";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  const password = String(form.get("password") || "");
  const displayName = String(form.get("displayName") || "");
  const base = requestOrigin(request);

  const result = await registerUserWithEmail({ email, password, displayName });
  if ("error" in result) {
    redirect(
      `${base}/?mode=signup&error=${encodeURIComponent(result.error)}`,
    );
  }

  void ensurePersonalRepo(result.user).catch(() => undefined);
  return redirectWithSession(sessionFromUser(result.user), `${base}/app/chat`);
}

export async function GET() {
  return NextResponse.redirect("/");
}
