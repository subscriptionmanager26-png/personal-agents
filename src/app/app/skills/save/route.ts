import { redirect } from "next/navigation";

import { readSkillTemplate } from "@/lib/skills";
import { requireOwner } from "@/lib/viewer";
import { upsertSkill } from "@/lib/workspaces";

function stripFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: markdown, description: "" };
  const description = match[1].match(/^description:\s*"?(.*?)"?\s*$/m)?.[1] ?? "";
  return { body: markdown.slice(match[0].length).trim(), description };
}

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const form = await request.formData();

  const templateId = String(form.get("template") || "");
  if (templateId) {
    const found = await readSkillTemplate(templateId);
    if (!found) redirect(`/app/skills?error=${encodeURIComponent("Template not found.")}`);
    const { body, description } = stripFrontmatter(found.content);
    const result = await upsertSkill(user.id, workspace.id, {
      name: found.template.name,
      description: description || found.template.description,
      content: body,
    });
    if ("error" in result) redirect(`/app/skills?error=${encodeURIComponent(result.error ?? "")}`);
    redirect(`/app/skills?edit=${result.skill.id}`);
  }

  const result = await upsertSkill(user.id, workspace.id, {
    id: String(form.get("id") || "") || undefined,
    name: String(form.get("name") || ""),
    description: String(form.get("description") || ""),
    content: String(form.get("content") || ""),
  });
  if ("error" in result) redirect(`/app/skills?error=${encodeURIComponent(result.error ?? "")}`);
  redirect("/app/skills");
}
