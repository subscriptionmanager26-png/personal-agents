import { NextResponse } from "next/server";

import { getJob } from "@/lib/jobs";
import { listVaultLabels, verifyVaultJobToken } from "@/lib/vault";

/** Metadata-only list for the vault MCP (never includes secrets). */
export async function GET(request: Request) {
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

  const handles = await listVaultLabels(claims.ownerUserId);
  return NextResponse.json({
    ok: true,
    handles: handles.map((h) => ({
      handle: h.id,
      label: h.label,
      username: h.username,
      origin: h.origin,
      kind: "login",
      available: true,
    })),
  });
}
