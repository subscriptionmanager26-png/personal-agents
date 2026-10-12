import { redirect } from "next/navigation";

import { createMemory, memoryRejection } from "@/lib/memory";
import { requireAgentUser } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user } = await requireAgentUser();

  const form = await request.formData();
  const title = String(form.get("title") || "").trim();
  const content = String(form.get("content") || "").trim();
  if (!title || !content) redirect("/app/memory");

  const rejection = memoryRejection(`${title}\n${content}`);
  if (rejection) redirect(`/app/memory?error=${encodeURIComponent(rejection)}`);

  await createMemory({
    ownerUserId: user.id,
    kind: "note",
    title,
    content,
    importance: Number(form.get("importance") || 4),
    source: "user",
  });
  redirect("/app/memory");
}
