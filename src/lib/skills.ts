import { promises as fs } from "node:fs";
import path from "node:path";

import type { SkillCatalogEntry } from "@/lib/types";

const CATALOG: SkillCatalogEntry[] = [
  {
    id: "financial-analysis",
    name: "Financial analysis",
    description:
      "Equity / company research workflow (filings, thesis, red flags). Ported from equity-research.",
    path: "financial-analysis",
    installPath: ".cursor/skills/research/financial-analysis",
  },
  {
    id: "general-research",
    name: "General research",
    description: "Lightweight web research and memo template for non-equity topics.",
    path: "general-research",
    installPath: ".cursor/skills/research/general-research",
  },
  {
    id: "vault-proxy",
    name: "Vault proxy",
    description:
      "Model-blind credential use: call APIs via the control-plane vault proxy without seeing secrets.",
    path: "vault-proxy",
    installPath: ".cursor/skills/security/vault-proxy",
  },
];

export function listSkillCatalog() {
  return CATALOG;
}

export function getSkillCatalogEntry(id: string) {
  return CATALOG.find((s) => s.id === id);
}

export async function readSkillFiles(skillId: string) {
  const entry = getSkillCatalogEntry(skillId);
  if (!entry) throw new Error(`Unknown skill: ${skillId}`);
  const root = path.join(process.cwd(), "skills-catalog", entry.path);
  const files: { relativePath: string; content: string }[] = [];

  async function walk(dir: string, prefix = "") {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, rel);
      } else if (ent.isFile()) {
        const content = await fs.readFile(full, "utf8");
        files.push({ relativePath: rel, content });
      }
    }
  }

  await walk(root);
  if (!files.length) {
    throw new Error(`Skill catalog empty for ${skillId}`);
  }
  return { entry, files };
}
