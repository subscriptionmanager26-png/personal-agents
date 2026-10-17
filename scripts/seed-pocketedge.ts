/**
 * Pocketedge workspace: company record, default skills, API key.
 *
 * Local:
 *   npx tsx --env-file=.env.local scripts/seed-pocketedge.ts
 *
 * Production store (after `vercel env pull` into .env.local):
 *   npx tsx --env-file=.env.local scripts/seed-pocketedge.ts https://personal-agents-psi.vercel.app
 *
 * Ops console: https://studio.pocketedge.in (or psi URL). Do not use agents.pocketedge.in — that
 * subdomain is reserved for inbound email (MX), not HTTP.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createApiKey, ensureSigningSecret } from "@/lib/company";
import { updateAgentRuntime } from "@/lib/runtime";
import { getStore } from "@/lib/store";
import { getUser, registerUserWithEmail } from "@/lib/users";
import { createWorkspace, getWorkspace, updateWorkspaceSettings, upsertSkill } from "@/lib/workspaces";

const BASE = (process.argv[2] || process.env.PUBLIC_URL || "http://localhost:43149").replace(/\/$/, "");
const EMAIL = process.env.POCKETEDGE_OWNER_EMAIL || "ops@pocketedge.local";
const PASSWORD = process.env.POCKETEDGE_OWNER_PASSWORD || "change-me-pocketedge-owner";

const INSTRUCTIONS = `You are Pocketedge's personal investing assistant for this client.
Be clear, numeric, and conservative with claims. Amounts in INR unless the client asks otherwise.
Follow Pocketedge's skills. Never place trades yourself; use propose_order only when the client asks to trade and can confirm in the app.
Never mention internal platforms, repositories, or tool names to the client.`;

const SKILL_DIR = path.join(process.cwd(), "scripts", "pocketedge", "skills");

function loadSkills(): { name: string; description: string; content: string }[] {
  try {
    const files = readdirSync(SKILL_DIR).filter((f) => f.endsWith(".md"));
    if (files.length) {
      return files.map((file) => {
        const content = readFileSync(path.join(SKILL_DIR, file), "utf8");
        const title = content.match(/^#\s+(.+)/m)?.[1]?.trim() || file.replace(/\.md$/, "");
        const desc = content.match(/^>.+\n/m)?.[0]?.replace(/^>\s*/, "").trim() || "Pocketedge playbook";
        return { name: title.slice(0, 80), description: desc.slice(0, 300), content };
      });
    }
  } catch {
    // fall through to catalog defaults
  }
  const catalog = path.join(process.cwd(), "skills-catalog");
  return ["financial-analysis", "general-research"].map((slug) => {
    const content = readFileSync(path.join(catalog, slug, "SKILL.md"), "utf8");
    const name = slug === "financial-analysis" ? "Financial analysis" : "General research";
    const description =
      slug === "financial-analysis"
        ? "Equity and portfolio research workflow for Pocketedge clients."
        : "Lightweight research memos for non-equity questions.";
    return { name, description, content };
  });
}

async function main() {
  const store = await getStore();
  let owner = Object.values(store.users).find((u) => u.email === EMAIL);
  if (!owner) {
    const reg = await registerUserWithEmail({ email: EMAIL, password: PASSWORD });
    if (!("user" in reg)) throw new Error(reg.error);
    owner = reg.user;
  }
  if (!owner.workspaceId) {
    const created = await createWorkspace(owner, { name: "Pocketedge", slug: "pocketedge" });
    if ("error" in created) throw new Error(created.error);
  }
  owner = (await getUser(owner.id))!;
  const ws = (await getWorkspace(owner.workspaceId))!;

  await updateWorkspaceSettings(owner.id, ws.id, {
    instructions: INSTRUCTIONS,
    memoryGuidance:
      "Risk tolerance, goals, horizon, tax bracket hints, major holdings they mention, and preferences (e.g. passive vs active).",
  });

  for (const skill of loadSkills()) {
    const existing = ws.skills.find((s) => s.name === skill.name);
    await upsertSkill(owner.id, ws.id, { id: existing?.id, ...skill });
  }
  await ensureSigningSecret(owner.id, ws.id);

  const keyFile = path.join(process.cwd(), ".data", "pocketedge-api-key");
  let keyText = process.env.POCKETEDGE_API_KEY?.trim();
  const hadKeys = (ws.apiKeys ?? []).length > 0;
  if (!keyText && !hadKeys) {
    const key = await createApiKey(owner.id, ws.id, "Pocketedge backend");
    if (!key) throw new Error("Could not create API key");
    keyText = key.key;
    writeFileSync(keyFile, keyText, { mode: 0o600 });
  } else if (!keyText) {
    console.log(`API key: reuse an existing key from Developers (not written; ${hadKeys} key(s) on workspace).`);
  } else {
    writeFileSync(keyFile, keyText, { mode: 0o600 });
  }

  if (BASE.startsWith("https://") && !ws.runtime?.agentPublicUrl) {
    const url = await updateAgentRuntime(owner.id, ws.id, { agentPublicUrl: BASE });
    if ("error" in url) console.warn(`Could not set public URL: ${url.error}`);
  }

  const fresh = (await getWorkspace(ws.id))!;
  console.log(`Owner login: ${EMAIL} / ${PASSWORD}`);
  console.log(`Workspace: Pocketedge (slug pocketedge, join /join/pocketedge)`);
  console.log(`Agent public URL: ${fresh.runtime?.agentPublicUrl || BASE}`);
  if (keyText) console.log(`API key written: ${path.relative(process.cwd(), keyFile)}`);
  console.log(`Skills: ${fresh.skills.map((s) => s.name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
