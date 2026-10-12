import { promises as fs } from "node:fs";
import path from "node:path";

import type { SkillTemplate, WorkspaceSkill } from "@/lib/types";

/** Starter skills an owner can copy into their workspace and edit. */
const TEMPLATES: SkillTemplate[] = [
  {
    id: "financial-analysis",
    name: "Financial analysis",
    description: "Equity / company research workflow (filings, thesis, red flags).",
    path: "financial-analysis",
  },
  {
    id: "general-research",
    name: "General research",
    description: "Lightweight web research and memo template for non-equity topics.",
    path: "general-research",
  },
];

export function listSkillTemplates() {
  return TEMPLATES;
}

export async function readSkillTemplate(templateId: string) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return undefined;
  const file = path.join(process.cwd(), "skills-catalog", template.path, "SKILL.md");
  const content = await fs.readFile(file, "utf8").catch(() => "");
  return content ? { template, content } : undefined;
}

export function skillInstallDir(skill: Pick<WorkspaceSkill, "slug">) {
  return `.cursor/skills/workspace/${skill.slug}`;
}

/** SKILL.md as written to client repos: owner content with Agent Skills frontmatter. */
export function renderSkillFile(skill: WorkspaceSkill) {
  if (skill.content.startsWith("---\n")) return `${skill.content}\n`;
  const description = (skill.description || skill.name).replace(/\s+/g, " ").replace(/"/g, "'");
  return `---\nname: ${skill.slug}\ndescription: "${description}"\n---\n\n${skill.content}\n`;
}
