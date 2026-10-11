import { NextResponse } from "next/server";

import {
  installSkillToUserRepo,
  uninstallSkillFlag,
} from "@/lib/github";
import { getSession } from "@/lib/session";
import { listSkillCatalog } from "@/lib/skills";
import { getUser } from "@/lib/users";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await getUser(session.id);
  return NextResponse.json({
    catalog: listSkillCatalog(),
    enabledSkillIds: user?.enabledSkillIds ?? [],
    agentRepository: user?.agentRepository,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    skillId?: string;
    action?: "install" | "uninstall";
  };
  if (!body.skillId) {
    return NextResponse.json({ error: "skillId required" }, { status: 400 });
  }
  const user = await getUser(session.id);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  try {
    if (body.action === "uninstall") {
      const updated = await uninstallSkillFlag(user, body.skillId);
      return NextResponse.json({ user: updated });
    }
    const updated = await installSkillToUserRepo(user, body.skillId);
    return NextResponse.json({ user: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
