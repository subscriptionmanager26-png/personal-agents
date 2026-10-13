import { redirect } from "next/navigation";

import { updateAgentRuntime } from "@/lib/runtime";
import { requireOwner } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();
  const clear = String(form.get("clear") || "");
  const field = (name: string) => (form.has(name) ? String(form.get(name) ?? "") : undefined);
  const result = await updateAgentRuntime(user.id, workspace.id, {
    cursorApiKey: field("cursorApiKey"),
    githubToken: field("githubToken"),
    githubOrg: field("githubOrg"),
    agentPublicUrl: field("agentPublicUrl"),
    clear: clear === "cursor" || clear === "github" ? clear : undefined,
  });
  if ("error" in result) redirect(`/app/developers?error=${encodeURIComponent(result.error)}#runtime`);
  redirect("/app/developers?saved=runtime#runtime");
}
