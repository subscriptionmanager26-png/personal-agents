import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/request-origin";
import { redirectWithSession, sessionFromUser } from "@/lib/session";
import { registerUserWithEmail } from "@/lib/users";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") || "");
  const password = String(form.get("password") || "");
  const displayName = String(form.get("displayName") || "");
  const joinSlug = String(form.get("workspace") || "").trim();
  const base = requestOrigin(request);

  let joinWorkspaceId: string | undefined;
  if (joinSlug) {
    const workspace = await getWorkspaceBySlug(joinSlug);
    if (!workspace) redirect(`${base}/?mode=signup&error=${encodeURIComponent("That signup link is not valid.")}`);
    joinWorkspaceId = workspace.id;
  }
  const back = joinSlug ? `${base}/join/${encodeURIComponent(joinSlug)}?mode=signup` : `${base}/?mode=signup`;

  const result = await registerUserWithEmail({ email, password, displayName, joinWorkspaceId });
  if ("error" in result) redirect(`${back}&error=${encodeURIComponent(result.error)}`);

  // Repos are provisioned on first message, once the person is allowed to use an agent.
  return redirectWithSession(sessionFromUser(result.user), `${base}/app`);
}

export async function GET() {
  return NextResponse.redirect("/");
}
