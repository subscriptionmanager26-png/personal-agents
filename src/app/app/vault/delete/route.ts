import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";
import { deleteVaultItem } from "@/lib/vault";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) redirect("/");

  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await deleteVaultItem(session.id, id);

  redirect("/app/vault");
}
