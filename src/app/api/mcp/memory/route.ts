import { NextResponse } from "next/server";

import { handleMemoryRpc } from "@/lib/memory-mcp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }
  const { status, json } = await handleMemoryRpc(bearer, body);
  if (json === undefined) return new Response(null, { status });
  return NextResponse.json(json, { status });
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
