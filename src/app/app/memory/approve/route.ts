import { redirect } from "next/navigation";

import { updateMemory } from "@/lib/memory";
import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) redirect("/");

  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (id) await updateMemory(session.id, id, { status: "active" });

  redirect("/app/memory");
}
