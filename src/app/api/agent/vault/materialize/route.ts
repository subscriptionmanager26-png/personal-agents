import { NextResponse } from "next/server";

import { getJob } from "@/lib/jobs";
import { revealVaultItem, verifyVaultJobToken } from "@/lib/vault";

/**
 * Materialize a secret for the trusted vault MCP process only.
 * The job token must live in the MCP server env — not in the agent shell
 * and never in the model prompt. Do not call this from chat/shell.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 401 });
  }

  let claims;
  try {
    claims = await verifyVaultJobToken(token);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const job = await getJob(claims.jobId);
  if (!job || job.ownerUserId !== claims.ownerUserId) {
    return NextResponse.json({ error: "job mismatch" }, { status: 403 });
  }
  if (job.status === "replied" || job.status === "error") {
    return NextResponse.json({ error: "job closed" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    handle?: string;
    label?: string;
    pageOrigin?: string;
  };

  if (!body.handle && !body.label) {
    return NextResponse.json(
      { error: "handle or label required" },
      { status: 400 },
    );
  }

  const item = await revealVaultItem({
    ownerUserId: claims.ownerUserId,
    jobId: claims.jobId,
    itemId: body.handle,
    label: body.label,
  });
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (item.origin) {
    if (!body.pageOrigin) {
      return NextResponse.json(
        { error: "pageOrigin required for origin-bound credential" },
        { status: 400 },
      );
    }
    try {
      const bound = new URL(item.origin);
      const page = new URL(body.pageOrigin);
      if (bound.host !== page.host) {
        return NextResponse.json(
          {
            error: "origin_mismatch",
            detail: `Credential bound to ${bound.host}, page is ${page.host}`,
          },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json({ error: "invalid origin" }, { status: 400 });
    }
  }

  return NextResponse.json({
    ok: true,
    handle: item.id,
    label: item.label,
    username: item.username,
    origin: item.origin,
    secret: item.secret,
  });
}
