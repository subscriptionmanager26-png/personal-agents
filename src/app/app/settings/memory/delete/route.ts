import { redirect } from "next/navigation";

import { deleteMemory } from "@/lib/memory";
import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) redirect("/");

  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await deleteMemory(session.id, id);

  redirect("/app/settings/memory");
}
