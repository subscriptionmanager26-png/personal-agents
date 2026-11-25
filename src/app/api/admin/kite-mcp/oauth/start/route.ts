import { NextResponse } from "next/server";

import { beginKiteMcpOAuth } from "@/lib/kite-mcp-oauth";
import { getConfig, isOperator } from "@/lib/config";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function authorized(request: Request) {
  const session = await getSession();
  if (session && isOperator(session)) return true;
  const secret = getConfig().cronSecret;
  if (secret) {
    const url = new URL(request.url);
    if (url.searchParams.get("secret") === secret) return true;
  }
  return false;
}

/** Operator OAuth bootstrap for hosted mcp.kite.trade (one-time, token ~24h). */
export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const { url } = await beginKiteMcpOAuth();
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Kite MCP OAuth.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}