import { redirect } from "next/navigation";

import { getViewer } from "@/lib/viewer";
import { createWorkspace } from "@/lib/workspaces";

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) redirect("/");
  if (viewer.user.workspaceId) redirect("/app");

  const form = await request.formData();
  const result = await createWorkspace(viewer.user, {
    name: String(form.get("name") || ""),
    slug: String(form.get("slug") || ""),
  });
  if ("error" in result) redirect(`/app?error=${encodeURIComponent(result.error)}`);
  redirect("/app/workspace");
}
