import { NextResponse } from "next/server";

import { isOperator } from "@/lib/config";
import { listAllJobs } from "@/lib/jobs";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { listUsers } from "@/lib/users";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isOperator(session)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const store = await getStore();
  return NextResponse.json({
    users: await listUsers(),
    jobs: await listAllJobs(100),
    auditEvents: store.auditEvents.slice(0, 100),
    installs: Object.values(store.slackInstalls || {}),
  });
}
