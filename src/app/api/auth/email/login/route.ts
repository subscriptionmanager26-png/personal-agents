import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/request-origin";
import { redirectWithSession, sessionFromUser } from "@/lib/session";
import { authenticateEmailPassword } from "@/lib/users";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  const password = String(form.get("password") || "");
  const joinSlug = String(form.get("workspace") || "").trim();
  const base = requestOrigin(request);

  const result = await authenticateEmailPassword({ email, password });
  if ("error" in result) {
    const back = joinSlug ? `${base}/join/${encodeURIComponent(joinSlug)}?mode=login` : `${base}/?mode=login`;
    redirect(`${back}&error=${encodeURIComponent(result.error)}`);
  }

  return redirectWithSession(sessionFromUser(result.user), `${base}/app`);
}

export async function GET() {
  return NextResponse.redirect("/");
}
