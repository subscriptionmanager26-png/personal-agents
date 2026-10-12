import { redirect } from "next/navigation";

import { deleteCompanyServer } from "@/lib/company";
import { requireOwner } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await deleteCompanyServer(user.id, workspace.id, id);
  redirect("/app/developers");
}
