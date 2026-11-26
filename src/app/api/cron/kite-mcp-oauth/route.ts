import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { kiteMcpBearer, kiteMcpAuthErrorMessage } from "@/lib/kite-mcp-oauth";

export const dynamic = "force-dynamic";

/** Logs when the hosted Kite MCP bearer is missing or expiring (Vercel cron, daily). */
export async function GET(request: Request) {
  const secret = getConfig().cronSecret;
  const url = new URL(request.url);
  if (!secret || (request.headers.get("authorization") !== `Bearer ${secret}` && url.searchParams.get("secret") !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bearer = await kiteMcpBearer();
  if (bearer) {
    return NextResponse.json({ ok: true, ready: true });
  }
  const message = await kiteMcpAuthErrorMessage();
  console.error("[cron/kite-mcp-oauth] bearer missing", { message });
  return NextResponse.json({ ok: true, ready: false, message }, { status: 503 });
}