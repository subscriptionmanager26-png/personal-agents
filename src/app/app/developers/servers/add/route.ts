import { redirect } from "next/navigation";

import { addCompanyServer, ensureSigningSecret } from "@/lib/company";
import { requireOwner } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  const result = await addCompanyServer(user.id, workspace.id, {
    name: String(form.get("name") || ""),
    url: String(form.get("url") || ""),
    description: String(form.get("description") || ""),
  });
  if ("error" in result) redirect(`/app/developers?error=${encodeURIComponent(result.error)}`);
  // Servers only receive user tokens once a signing secret exists.
  await ensureSigningSecret(user.id, workspace.id);
  redirect("/app/developers");
}
