import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/request-origin";
import { redirectWithSession, sessionFromUser } from "@/lib/session";
import { authenticateEmailPassword } from "@/lib/users";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  const password = String(form.get("password") || "");
  const base = requestOrigin(request);

  const result = await authenticateEmailPassword({ email, password });
  if ("error" in result) {
    redirect(
      `${base}/?mode=login&error=${encodeURIComponent(result.error)}`,
    );
  }

  return redirectWithSession(sessionFromUser(result.user), `${base}/app/chat`);
}

export async function GET() {
  return NextResponse.redirect("/");
}
