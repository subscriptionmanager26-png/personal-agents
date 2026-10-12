import { redirect } from "next/navigation";

import { deleteConnection } from "@/lib/connections";
import { requireAgentUser } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user } = await requireAgentUser();
  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await deleteConnection(user.id, id);
  redirect("/app/connections");
}
