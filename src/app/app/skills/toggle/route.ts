import { redirect } from "next/navigation";

import {
  installSkillToUserRepo,
  uninstallSkillFlag,
} from "@/lib/github";
import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) redirect("/");

  const form = await request.formData();
  const skillId = String(form.get("skillId") || "");
  const action = String(form.get("action") || "install");

  if (!skillId) redirect("/app/skills?error=skillId%20required");

  const user = await getUser(session.id);
  if (!user) redirect("/app/skills?error=user%20not%20found");

  try {
    if (action === "uninstall") {
      await uninstallSkillFlag(user, skillId);
    } else {
      await installSkillToUserRepo(user, skillId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    redirect(`/app/skills?error=${encodeURIComponent(message)}`);
  }

  redirect("/app/skills");
}
