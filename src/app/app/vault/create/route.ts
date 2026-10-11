import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";
import { createVaultItem } from "@/lib/vault";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) redirect("/");

  const form = await request.formData();
  const label = String(form.get("label") || "").trim();
  const username = String(form.get("username") || "").trim();
  const origin = String(form.get("origin") || "").trim();
  const secret = String(form.get("secret") || "").trim();

  if (label && secret) {
    await createVaultItem({
      ownerUserId: session.id,
      label,
      username: username || undefined,
      origin: origin || undefined,
      secret,
    });
  }

  redirect("/app/vault");
}
