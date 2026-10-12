import { redirect } from "next/navigation";

import type { MembershipStatus } from "@/lib/types";
import { requireOwner } from "@/lib/viewer";
import { setClientStatus } from "@/lib/workspaces";

const STATUSES = new Set<MembershipStatus>(["active", "suspended", "pending"]);

export async function POST(request: Request) {
  const { user } = await requireOwner();
  const form = await request.formData();
  const id = String(form.get("id") || "");
  const status = String(form.get("status") || "") as MembershipStatus;
  if (id && STATUSES.has(status)) await setClientStatus(user.id, id, status);
  redirect("/app/clients");
}
