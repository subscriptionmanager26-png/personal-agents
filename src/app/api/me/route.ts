import { NextResponse } from "next/server";

import { activeBackend } from "@/lib/store";
import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";
import { listJobsForUser } from "@/lib/jobs";
import { runtimeForUser } from "@/lib/runtime";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await getUser(session.id);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const jobs = await listJobsForUser(user.id, 20);
  return NextResponse.json({
    user,
    jobs,
    meta: {
      store: activeBackend(),
      mockCursor: !(await runtimeForUser(user)).cursorApiKey,
    },
  });
}
