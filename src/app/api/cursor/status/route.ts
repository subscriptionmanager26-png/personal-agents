import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { settleByAgentId } from "@/lib/settle";

function verifySignature(rawBody: string, signature: string | null) {
  const secret = getConfig().cursorStatusWebhookSecret;
  if (!secret) return true;
  if (!signature) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(signature.replace(/^sha256=/, ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-webhook-signature") ||
    request.headers.get("x-cursor-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: {
    id?: string;
    status?: string;
    agentId?: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const agentId = body.id || body.agentId;
  const status = (body.status || "").toUpperCase();
  if (
    agentId &&
    (status.includes("FINISH") ||
      status.includes("ERROR") ||
      status === "IDLE" ||
      status.includes("COMPLETE") ||
      !body.status)
  ) {
    await settleByAgentId(agentId);
  }
  return NextResponse.json({ ok: true });
}
