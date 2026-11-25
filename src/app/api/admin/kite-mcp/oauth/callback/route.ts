import { NextResponse } from "next/server";

import { completeKiteMcpOAuth } from "@/lib/kite-mcp-oauth";

export const dynamic = "force-dynamic";

function html(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:36rem;line-height:1.5}</style></head>
<body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (error) {
    return html("Kite MCP OAuth failed", `<p>${error}</p>`, 400);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return html("Kite MCP OAuth", "<p>Missing code or state.</p>", 400);
  }
  try {
    await completeKiteMcpOAuth({ code, state });
    return html(
      "Kite MCP connected",
      "<p><strong>Success.</strong> The agent backend can talk to Zerodha MCP again. You can close this tab and retry Connect Zerodha on Pocketedge.</p>",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed.";
    return html("Kite MCP OAuth failed", `<p>${message}</p>`, 502);
  }
}