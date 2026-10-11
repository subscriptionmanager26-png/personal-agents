import { NextResponse } from "next/server";

import { handleSlackEnvelope } from "@/lib/handle-slack";
import { verifySlackSignature } from "@/lib/slack";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");

  // Allow local mock without signing secret
  if (process.env.SLACK_SIGNING_SECRET) {
    const ok = verifySlackSignature({ signature, timestamp, rawBody });
    if (!ok) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = await handleSlackEnvelope(
    body as Parameters<typeof handleSlackEnvelope>[0],
  );
  if (result && "challenge" in result) {
    return NextResponse.json({ challenge: result.challenge });
  }
  return NextResponse.json(result ?? { ok: true });
}
