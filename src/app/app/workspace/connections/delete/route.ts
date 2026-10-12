import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/viewer";
import { deleteSuggestedConnection } from "@/lib/workspaces";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await deleteSuggestedConnection(user.id, workspace.id, id);
  redirect("/app/workspace");
}
