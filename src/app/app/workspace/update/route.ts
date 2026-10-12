import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/viewer";
import { updateWorkspaceSettings } from "@/lib/workspaces";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  await updateWorkspaceSettings(user.id, workspace.id, {
    name: String(form.get("name") || ""),
    instructions: String(form.get("instructions") || ""),
    memoryGuidance: String(form.get("memoryGuidance") || ""),
  });
  redirect("/app/workspace?saved=1");
}
