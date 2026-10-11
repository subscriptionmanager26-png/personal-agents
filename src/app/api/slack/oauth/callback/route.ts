import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/request-origin";
import { finishWorkspaceOAuth } from "@/lib/slack-oauth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const base = requestOrigin(request);
  if (!code || !state) {
    return NextResponse.redirect(`${base}/?slack=error`);
  }
  try {
    const team = await finishWorkspaceOAuth({ code, state });
    return NextResponse.redirect(
      `${base}/?slack=installed&team=${encodeURIComponent(team.id || "")}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.redirect(
      `${base}/?slack=error&error=${encodeURIComponent(message)}`,
    );
  }
}
