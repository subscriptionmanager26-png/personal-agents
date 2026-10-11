import { redirect } from "next/navigation";

import { createMemory } from "@/lib/memory";
import { getSession } from "@/lib/session";
import type { MemoryKind } from "@/lib/types";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) redirect("/");

  const form = await request.formData();
  const title = String(form.get("title") || "").trim();
  const content = String(form.get("content") || "").trim();
  const kind = (String(form.get("kind") || "note") as MemoryKind) || "note";
  const pinned = form.get("pinned") === "on";

  if (title && content) {
    await createMemory({
      ownerUserId: session.id,
      kind,
      title,
      content,
      pinned,
    });
  }

  redirect("/app/memory");
}
