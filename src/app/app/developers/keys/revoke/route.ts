import { redirect } from "next/navigation";

import { revokeApiKey } from "@/lib/company";
import { requireOwner } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await revokeApiKey(user.id, workspace.id, id);
  redirect("/app/developers");
}
