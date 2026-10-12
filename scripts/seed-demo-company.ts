/**
 * Local demo: a personal-finance company with its guides, the mock Zerodha and
 * backtest MCP servers, and an API key written to .data/finco-api-key.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/seed-demo-company.ts [baseUrl]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { addCompanyServer, createApiKey, ensureSigningSecret } from "@/lib/company";
import { getStore } from "@/lib/store";
import { getUser, registerUserWithEmail } from "@/lib/users";
import { createWorkspace, getWorkspace, updateWorkspaceSettings, upsertSkill } from "@/lib/workspaces";

const BASE = (process.argv[2] || "http://localhost:43149").replace(/\/$/, "");
const EMAIL = "ops@finco.local";
const PASSWORD = "demo-pass-123";

const PORTFOLIO_GUIDE = `# FinCo portfolio review

1. Fetch holdings with zerodha get_holdings. If the session expired, call request_login with the login_url and stop.
2. Show a card with total value, day P&L and overall P&L.
3. Show a holdings table (symbol, qty, avg price, LTP, value, P&L %).
4. Show a bar chart of allocation by holding.
5. Flag: any single stock above 20% of the portfolio, more than 40% in one sector, and losers down more than 25%.
6. End with at most three concrete actions. Never place orders; use propose_order only when the user asks to trade.
7. Save the user's stated goals and risk appetite to memory.`;

const RESEARCH_GUIDE = `# FinCo stock research

1. Get the live quote with zerodha get_quote.
2. Cover: business in two lines, growth, margins, debt, valuation vs 5-year average, key risks.
3. Check fit against the user's remembered goals and existing exposure.
4. Show a card with a verdict: Accumulate, Hold or Avoid, plus one-line reasoning.
5. Say plainly this is research, not a recommendation to trade.`;

async function main() {
  const store = await getStore();
  let owner = Object.values(store.users).find((u) => u.email === EMAIL);
  if (!owner) {
    const reg = await registerUserWithEmail({ email: EMAIL, password: PASSWORD });
    if (!("user" in reg)) throw new Error(reg.error);
    owner = reg.user;
  }
  if (!owner.workspaceId) {
    const created = await createWorkspace(owner, { name: "FinCo Money", slug: "finco" });
    if ("error" in created) throw new Error(created.error);
  }
  owner = (await getUser(owner.id))!;
  const ws = (await getWorkspace(owner.workspaceId))!;

  await updateWorkspaceSettings(owner.id, ws.id, {
    instructions:
      "You are FinCo's investing assistant for Indian retail investors. Be concise and numeric. Amounts in INR. Follow FinCo's guides. Never place trades yourself.",
  });
  for (const [name, description, content] of [
    ["Portfolio review", "FinCo's method for reviewing a user's holdings", PORTFOLIO_GUIDE],
    ["Stock research", "FinCo's checklist for researching one stock", RESEARCH_GUIDE],
  ] as const) {
    const existing = ws.skills.find((s) => s.name === name);
    await upsertSkill(owner.id, ws.id, { id: existing?.id, name, description, content });
  }
  for (const name of ["zerodha", "backtest"]) {
    if (ws.companyServers?.some((s) => s.name === name)) continue;
    const added = await addCompanyServer(owner.id, ws.id, {
      name,
      url: `${BASE}/api/mock/${name}`,
      description: name === "zerodha" ? "Holdings and quotes (read-only)" : "FinCo momentum backtesting engine",
    });
    if ("error" in added) throw new Error(added.error);
  }
  await ensureSigningSecret(owner.id, ws.id);

  const key = await createApiKey(owner.id, ws.id, "Local demo");
  if (!key) throw new Error("Could not create API key");
  const keyFile = path.join(process.cwd(), ".data", "finco-api-key");
  writeFileSync(keyFile, key.key, { mode: 0o600 });

  console.log(`Owner: ${EMAIL} / ${PASSWORD}`);
  console.log(`Workspace: FinCo Money (${ws.slug})`);
  console.log(`API key written to ${path.relative(process.cwd(), keyFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
