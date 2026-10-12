import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/viewer";
import { deleteSkill } from "@/lib/workspaces";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await deleteSkill(user.id, workspace.id, id);
  redirect("/app/skills");
}
