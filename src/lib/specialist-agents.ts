/**
 * Specialist chats share the main Cloud Agents path (createAgent / createRun).
 * The thread id picks the repository. PocketEdge MF chats use `adv_mf`.
 */

const DEFAULT_MF_REPO = "https://github.com/subscriptionmanager26-png/Mutualfundscreener";

export type SpecialistKind = "mf";

export type SpecialistRepo = {
  kind: SpecialistKind;
  url: string;
  ref: string;
};

export function specialistForThread(threadId: string | null | undefined): SpecialistRepo | undefined {
  const id = (threadId ?? "").trim();
  if (id !== "adv_mf" && !id.startsWith("adv_mf_")) return undefined;
  const url = (process.env.MF_AGENT_REPOSITORY || DEFAULT_MF_REPO).trim() || DEFAULT_MF_REPO;
  const ref = (process.env.MF_AGENT_REF || "main").trim() || "main";
  return { kind: "mf", url, ref };
}

/** Inlined into the same personal-agent prompt. The client must not hear these commands. */
export function mfAgentInstructions() {
  return `## Mutual funds
You are answering as MF AI. Use the mutual-fund screener in this environment. Do not answer as the general market assistant.

The database is local Postgres named mfscreener and is already loaded. Before a fund question, run:

source .venv/bin/activate 2>/dev/null || { python3 -m venv .venv && source .venv/bin/activate; }
pip install -q -e ".[dev]"
mf-job catch-up

Then read screener_wide, or the local API (mfscreener.api.main). Default to Direct Growth plans. Use only published NAV metrics: returns, TER, volatility, drawdown, Sharpe, Sortino, beta, alpha, and category rank. An empty horizon means that scheme's history does not reach it. IDCW options understate total return, so compare growth options.

Do not invent NAVs, ranks, or expense ratios. Do not place mutual-fund orders. Do not commit, push, or open a pull request. Do not tell the client about the database, these commands, or this environment.
`;
}
