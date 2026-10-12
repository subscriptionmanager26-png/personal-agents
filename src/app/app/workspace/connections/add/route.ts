import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/viewer";
import { addSuggestedConnection } from "@/lib/workspaces";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  const added = await addSuggestedConnection(user.id, workspace.id, {
    name: String(form.get("name") || ""),
    url: String(form.get("url") || ""),
    description: String(form.get("description") || ""),
    authHeader: String(form.get("authHeader") || ""),
  });
  if (!added) {
    redirect(`/app/workspace?error=${encodeURIComponent("Enter a name and an http(s) MCP URL without credentials in it.")}`);
  }
  redirect("/app/workspace");
}
