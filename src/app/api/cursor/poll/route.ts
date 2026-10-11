import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { pollDispatchedJobs } from "@/lib/settle";

export async function GET(request: Request) {
  const cfg = getConfig();
  const auth = request.headers.get("authorization");
  const url = new URL(request.url);
  const key = url.searchParams.get("secret");
  const ok =
    !cfg.cronSecret ||
    auth === `Bearer ${cfg.cronSecret}` ||
    key === cfg.cronSecret;
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await pollDispatchedJobs();
  return NextResponse.json({ ok: true });
}
