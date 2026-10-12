import { peekTokenWorkspace, signingSecretFor, verifyCompanyUserToken } from "@/lib/company";
import { sha256 } from "@/lib/crypto";
import { getWorkspaceBySlug } from "@/lib/workspaces";

/** Stand-ins for a company's broker and backtesting MCP servers, for local development. */
export function mockCompanyServersEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_MOCK_COMPANY_MCP === "1";
}

/**
 * Verifies the per-user token the way a company server would: pick the workspace
 * secret by the `ws` claim, then check signature, issuer and audience.
 */
export async function verifyMockCaller(bearer: string, routePath: string) {
  const slug = peekTokenWorkspace(bearer);
  const workspace = slug ? await getWorkspaceBySlug(slug) : undefined;
  const secret = workspace ? signingSecretFor(workspace) : undefined;
  if (!workspace || !secret) return undefined;
  const server = (workspace.companyServers ?? []).find((s) => {
    try {
      return new URL(s.url).pathname.replace(/\/$/, "") === routePath;
    } catch {
      return false;
    }
  });
  if (!server) return undefined;
  try {
    const claims = await verifyCompanyUserToken(bearer, secret, server.name);
    return { ...claims, workspaceId: workspace.id };
  } catch {
    return undefined;
  }
}

function rng(seed: string) {
  let state = sha256(seed).readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

const UNIVERSE: Record<string, number> = {
  RELIANCE: 2905,
  TCS: 4110,
  INFY: 1522,
  HDFCBANK: 1648,
  ICICIBANK: 1184,
  ITC: 468,
  LT: 3610,
  SBIN: 822,
  BHARTIARTL: 1502,
  ASIANPAINT: 2890,
  TATAMOTORS: 978,
  SUNPHARMA: 1702,
  NIFTYBEES: 271,
  GOLDBEES: 62,
};

export function mockQuote(symbol: string) {
  const base = UNIVERSE[symbol.toUpperCase()];
  if (!base) return undefined;
  const r = rng(`${symbol}:${new Date().toISOString().slice(0, 10)}`);
  const change = (r() - 0.5) * 4;
  return {
    tradingsymbol: symbol.toUpperCase(),
    exchange: "NSE",
    last_price: Math.round(base * (1 + change / 100) * 100) / 100,
    day_change_percentage: Math.round(change * 100) / 100,
  };
}

/** A stable, different portfolio for every user id. */
export function mockHoldings(userId: string) {
  const r = rng(`holdings:${userId}`);
  const symbols = Object.keys(UNIVERSE).sort(() => r() - 0.5).slice(0, 6 + Math.floor(r() * 4));
  return symbols.map((symbol) => {
    const quote = mockQuote(symbol)!;
    const quantity = symbol.endsWith("BEES") ? 50 + Math.floor(r() * 400) : 5 + Math.floor(r() * 60);
    const average = Math.round(quote.last_price * (0.7 + r() * 0.5) * 100) / 100;
    return {
      tradingsymbol: symbol,
      exchange: "NSE",
      quantity,
      average_price: average,
      last_price: quote.last_price,
      pnl: Math.round((quote.last_price - average) * quantity * 100) / 100,
      day_change_percentage: quote.day_change_percentage,
    };
  });
}

type SessionMap = Map<string, string>;
const sessions: SessionMap = ((globalThis as { __mockBrokerSessions?: SessionMap }).__mockBrokerSessions ??= new Map());
const today = () => new Date().toISOString().slice(0, 10);

/** Broker sessions expire daily, like Kite's; the user logs in through a link. */
export function hasBrokerSession(workspaceId: string, userId: string) {
  return sessions.get(`${workspaceId}:${userId}`) === today();
}

export function startBrokerSession(workspaceId: string, userId: string) {
  sessions.set(`${workspaceId}:${userId}`, today());
}

export function mockBacktest(args: { symbol?: string; lookback_days?: number; holding_days?: number; years?: number }) {
  const lookback = Math.min(Math.max(Math.round(args.lookback_days ?? 90), 10), 365);
  const holding = Math.min(Math.max(Math.round(args.holding_days ?? 20), 1), 120);
  const years = Math.min(Math.max(Math.round(args.years ?? 3), 1), 10);
  const universe = (args.symbol || "NIFTY50").toUpperCase();
  const r = rng(`bt:${universe}:${lookback}:${holding}:${years}`);
  const months = years * 12;
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  let strategy = 100;
  let benchmark = 100;
  let peak = 100;
  let maxDrawdown = 0;
  let wins = 0;
  const edge = (lookback >= 60 && lookback <= 180 ? 0.006 : 0.002) - holding / 10_000;
  const curve: { date: string; strategy: number; benchmark: number }[] = [];
  for (let m = 0; m <= months; m++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + m);
    if (m > 0) {
      const market = (r() - 0.45) * 0.08;
      const ret = market * 1.2 + edge + (r() - 0.5) * 0.03;
      benchmark *= 1 + market;
      strategy *= 1 + ret;
      if (ret > 0) wins++;
      peak = Math.max(peak, strategy);
      maxDrawdown = Math.max(maxDrawdown, (peak - strategy) / peak);
    }
    curve.push({ date: d.toISOString().slice(0, 7), strategy: Math.round(strategy * 10) / 10, benchmark: Math.round(benchmark * 10) / 10 });
  }
  const cagr = Math.pow(strategy / 100, 1 / years) - 1;
  const benchCagr = Math.pow(benchmark / 100, 1 / years) - 1;
  return {
    strategy: `${lookback}-day momentum, rebalanced every ${holding} trading days`,
    universe,
    period: `${curve[0].date} to ${curve[curve.length - 1].date}`,
    metrics: {
      cagr_percent: Math.round(cagr * 1000) / 10,
      benchmark_cagr_percent: Math.round(benchCagr * 1000) / 10,
      max_drawdown_percent: Math.round(maxDrawdown * 1000) / 10,
      sharpe: Math.round((cagr / Math.max(maxDrawdown, 0.05)) * 100) / 100,
      win_rate_percent: Math.round((wins / months) * 1000) / 10,
      trades: Math.round((months * 21) / holding) * 5,
    },
    equity_curve: curve,
  };
}
