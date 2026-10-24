/**
 * Pocketedge workspace: company record, default skills, API key.
 *
 * Local:
 *   npx tsx --env-file=.env.local scripts/seed-pocketedge.ts
 *
 * Production store (after `vercel env pull` into .env.local):
 *   npx tsx --env-file=.env.local scripts/seed-pocketedge.ts https://personal-agents-psi.vercel.app
 */
import { seedPocketedge } from "@/lib/seed-pocketedge";

const BASE = (process.argv[2] || process.env.PUBLIC_URL || "http://localhost:43149").replace(/\/$/, "");

seedPocketedge({ publicUrl: BASE, writeKeyFile: true })
  .then((r) => {
    console.log(`Owner login: ${r.email}`);
    console.log(`Workspace: Pocketedge (slug ${r.workspaceSlug}, join /join/pocketedge)`);
    console.log(`Agent public URL: ${r.agentPublicUrl}`);
    if (r.apiKeyCreated) console.log(`API key written: .data/pocketedge-api-key`);
    console.log(`Skills: ${r.skills.join(", ")}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
