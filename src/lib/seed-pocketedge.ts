import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createApiKey, ensureSigningSecret, registerApiKeyFromPlaintext } from "@/lib/company";
import { updateAgentRuntime } from "@/lib/runtime";
import { getStore } from "@/lib/store";
import { getUser, registerUserWithEmail } from "@/lib/users";
import { createWorkspace, getWorkspace, updateWorkspaceSettings, upsertSkill } from "@/lib/workspaces";

const INSTRUCTIONS = `You are Pocketedge's personal investing assistant for this client.
Be clear, numeric, and conservative with claims. Amounts in INR unless the client asks otherwise.
Follow Pocketedge's skills. Never place trades yourself; use propose_order only when the client asks to trade and can confirm in the app.
Never mention internal platforms, repositories, or tool names to the client.`;

function loadSkills(): { name: string; description: string; content: string }[] {
  const skillDir = path.join(process.cwd(), "scripts", "pocketedge", "skills");
  try {
    const files = readdirSync(skillDir).filter((f) => f.endsWith(".md"));
    if (files.length) {
      return files.map((file) => {
        const content = readFileSync(path.join(skillDir, file), "utf8");
        const title = content.match(/^#\s+(.+)/m)?.[1]?.trim() || file.replace(/\.md$/, "");
        const desc = content.match(/^>.+\n/m)?.[0]?.replace(/^>\s*/, "").trim() || "Pocketedge playbook";
        return { name: title.slice(0, 80), description: desc.slice(0, 300), content };
      });
    }
  } catch {
    // fall through
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

export type SeedPocketedgeResult = {
  email: string;
  workspaceSlug: string;
  agentPublicUrl: string;
  apiKeyCreated: boolean;
  /** Present only when a new key was minted this run (hashed in store otherwise). */
  apiKey?: string;
  skills: string[];
};

/** Ensure Pocketedge workspace, skills, and at least one API key exist in the active store. */
export async function seedPocketedge(opts?: {
  publicUrl?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  writeKeyFile?: boolean;
}): Promise<SeedPocketedgeResult> {
  const base = (opts?.publicUrl || process.env.PUBLIC_URL || "http://localhost:43149").replace(/\/$/, "");
  const email = opts?.ownerEmail || process.env.POCKETEDGE_OWNER_EMAIL || "ops@pocketedge.local";
  const password = opts?.ownerPassword || process.env.POCKETEDGE_OWNER_PASSWORD || "change-me-pocketedge-owner";

  const store = await getStore();
  let owner = Object.values(store.users).find((u) => u.email === email);
  if (!owner) {
    const reg = await registerUserWithEmail({ email, password });
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

  let apiKeyCreated = false;
  let keyText = process.env.POCKETEDGE_API_KEY?.trim();
  const hadKeys = (ws.apiKeys ?? []).length > 0;
  if (!hadKeys) {
    if (keyText) {
      const ok = await registerApiKeyFromPlaintext(owner.id, ws.id, keyText, "Pocketedge backend");
      if (!ok) throw new Error("POCKETEDGE_API_KEY is not a valid pa_… key or workspace mismatch");
      apiKeyCreated = true;
    } else {
      const key = await createApiKey(owner.id, ws.id, "Pocketedge backend");
      if (!key) throw new Error("Could not create API key");
      keyText = key.key;
      apiKeyCreated = true;
    }
    if (opts?.writeKeyFile !== false && !process.env.VERCEL && keyText) {
      const keyFile = path.join(process.cwd(), ".data", "pocketedge-api-key");
      writeFileSync(keyFile, keyText, { mode: 0o600 });
    }
  } else if (keyText && opts?.writeKeyFile !== false && !process.env.VERCEL) {
    writeFileSync(path.join(process.cwd(), ".data", "pocketedge-api-key"), keyText, { mode: 0o600 });
  }

  if (base.startsWith("https://") && !ws.runtime?.agentPublicUrl) {
    const url = await updateAgentRuntime(owner.id, ws.id, { agentPublicUrl: base });
    if ("error" in url) console.warn(`Could not set public URL: ${url.error}`);
  }

  const fresh = (await getWorkspace(ws.id))!;
  return {
    email,
    workspaceSlug: "pocketedge",
    agentPublicUrl: fresh.runtime?.agentPublicUrl || base,
    apiKeyCreated,
    apiKey: apiKeyCreated ? keyText : undefined,
    skills: fresh.skills.map((s) => s.name),
  };
}
