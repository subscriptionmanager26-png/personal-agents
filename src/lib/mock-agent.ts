import { callAgentTool } from "@/lib/agent-mcp";
import { createCompanyUserToken, signingSecretFor } from "@/lib/company";
import { mcpCallTool, mcpListTools } from "@/lib/mcp-client";
import { mockReplyText } from "@/lib/mock-trace";
import type { Job, PersonalUser, Workspace } from "@/lib/types";

/**
 * Stand-in for a Cursor agent when CURSOR_API_KEY is unset. It follows the same
 * contract as a real run: calls the company's MCP servers with the signed user
 * token and reports through the personal-agent tools.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type Tool = { url: string; token: string };

async function findTools(workspace: Workspace | undefined, user: PersonalUser) {
  const tools = new Map<string, Tool>();
  if (!workspace || !signingSecretFor(workspace)) return tools;
  for (const server of workspace.companyServers ?? []) {
    try {
      const token = await createCompanyUserToken(workspace, user, server.name);
      for (const name of await mcpListTools(server.url, token)) tools.set(name, { url: server.url, token });
    } catch {
      // server down: the agent works with what it has
    }
  }
  return tools;
}

export async function runMockAgent(user: PersonalUser, job: Job, workspace: Workspace | undefined) {
  const caller = { ownerUserId: user.id, jobId: job.id };
  const ui = (name: string, args: Record<string, unknown>) => callAgentTool(caller, name, args);
  const status = async (label: string) => {
    await ui("update_status", { label });
    await sleep(900);
  };
  const tools = await findTools(workspace, user);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    return tool ? mcpCallTool(tool.url, tool.token, name, args) : undefined;
  };
  const text = job.prompt;
  const lower = text.toLowerCase();
  const note = "\n\n_(Simulated agent: CURSOR_API_KEY is not set, so this reply is scripted around real tool calls.)_";

  const trade = text.match(/\b(buy|sell)\s+(?:(\d+)\s+)?(?:shares?\s+(?:of\s+)?)?([A-Za-z&]{2,20})\b/i);
  if (trade && tools.has("get_quote")) {
    const [, sideWord, qtyText, rawSymbol] = trade;
    const symbol = rawSymbol.toUpperCase();
    await status(`Checking the latest ${symbol} price`);
    const quote = await call("get_quote", { symbol });
    if (!quote || quote.isError) return `I couldn't find ${symbol} on NSE. Check the symbol and try again.${note}`;
    const price = Number(quote.data.last_price);
    const quantity = Number(qtyText) || 1;
    const limit = Math.round(price * (sideWord.toLowerCase() === "buy" ? 1.002 : 0.998) * 20) / 20;
    await ui("propose_order", {
      symbol,
      side: sideWord.toUpperCase(),
      quantity,
      order_type: "LIMIT",
      price: limit,
      product: "CNC",
      rationale: `${symbol} last traded at ${inr(price)}. A limit at ${inr(limit)} keeps you within 0.2% of the market.`,
    });
    return `I've prepared an order to ${sideWord.toLowerCase()} ${quantity} ${symbol} at ${inr(limit)} (limit, delivery). It is **not placed yet**: review it and tap Confirm in the app.${note}`;
  }

  if (/backtest|momentum|strateg/.test(lower) && tools.has("run_backtest")) {
    const lookback = Number(lower.match(/(\d+)[\s-]*day/)?.[1]) || 90;
    const symbol = text.match(/\b(NIFTY50|[A-Z]{3,15})\b/)?.[1];
    await status(`Running a ${lookback}-day momentum backtest`);
    const result = await call("run_backtest", { lookback_days: lookback, ...(symbol ? { symbol } : {}) });
    if (!result || result.isError) return `The backtesting engine didn't respond. Please try again shortly.${note}`;
    const m = result.data.metrics as Record<string, number>;
    await ui("show_card", {
      title: `${result.data.strategy}`,
      tone: m.cagr_percent > m.benchmark_cagr_percent ? "success" : "warning",
      body: `${result.data.universe}, ${result.data.period}`,
      fields: [
        { label: "CAGR", value: `${m.cagr_percent}%` },
        { label: "Benchmark CAGR", value: `${m.benchmark_cagr_percent}%` },
        { label: "Max drawdown", value: `${m.max_drawdown_percent}%` },
        { label: "Sharpe", value: String(m.sharpe) },
        { label: "Win rate", value: `${m.win_rate_percent}%` },
        { label: "Trades", value: String(m.trades) },
      ],
    });
    await ui("show_chart", {
      title: "Growth of ₹100",
      chart_type: "line",
      x_key: "date",
      series: [
        { key: "strategy", label: "Strategy" },
        { key: "benchmark", label: "Benchmark" },
      ],
      data: result.data.equity_curve,
    });
    const beat = m.cagr_percent > m.benchmark_cagr_percent;
    return `The ${lookback}-day momentum strategy ${beat ? "beat" : "lagged"} the benchmark (${m.cagr_percent}% vs ${m.benchmark_cagr_percent}% a year), with a worst drop of ${m.max_drawdown_percent}%. ${beat ? "Worth considering, but expect deep drawdowns." : "Try a longer lookback, e.g. 120 days."}${note}`;
  }

  if (/portfolio|holding|review|rebalanc/.test(lower) && tools.has("get_holdings")) {
    await status("Fetching your holdings from Zerodha");
    const result = await call("get_holdings");
    if (!result) return `I couldn't reach Zerodha just now.${note}`;
    if (result.isError && typeof result.data.login_url === "string") {
      await ui("request_login", {
        service: "Zerodha",
        url: result.data.login_url,
        message: "Your Zerodha session has expired. Log in, then ask me again.",
      });
      return `Your Zerodha session has expired. Please log in with the button above, then ask me again.${note}`;
    }
    const holdings = (result.data.holdings as Record<string, number | string>[]) ?? [];
    await status("Reviewing allocation against your goals");
    const value = holdings.reduce((s, h) => s + Number(h.last_price) * Number(h.quantity), 0);
    const pnl = holdings.reduce((s, h) => s + Number(h.pnl), 0);
    const rows = holdings
      .map((h) => {
        const v = Number(h.last_price) * Number(h.quantity);
        return {
          symbol: h.tradingsymbol,
          quantity: h.quantity,
          value: Math.round(v),
          weight: Math.round((v / value) * 1000) / 10,
          pnl: Math.round(Number(h.pnl)),
        };
      })
      .sort((a, b) => b.value - a.value);
    const heavy = rows.filter((r) => r.weight > 10);
    await ui("show_card", {
      title: "Portfolio summary",
      tone: heavy.length > 2 ? "warning" : "info",
      fields: [
        { label: "Value", value: inr(value) },
        { label: "Unrealised P&L", value: inr(pnl) },
        { label: "Holdings", value: String(rows.length) },
        { label: "Largest position", value: `${rows[0]?.symbol} (${rows[0]?.weight}%)` },
      ],
    });
    await ui("show_table", {
      title: "Holdings",
      columns: [
        { key: "symbol", label: "Symbol" },
        { key: "quantity", label: "Qty", format: "number" },
        { key: "value", label: "Value", format: "currency" },
        { key: "weight", label: "Weight", format: "percent" },
        { key: "pnl", label: "P&L", format: "currency" },
      ],
      rows,
    });
    await ui("show_chart", {
      title: "Allocation",
      chart_type: "bar",
      x_key: "symbol",
      series: [{ key: "weight", label: "Weight %" }],
      data: rows,
    });
    await ui("memory_save", {
      kind: "portfolio_snapshot",
      title: `Portfolio on ${new Date().toISOString().slice(0, 10)}`,
      content: `Value ${inr(value)}, P&L ${inr(pnl)}, ${rows.length} holdings. Top: ${rows
        .slice(0, 3)
        .map((r) => `${r.symbol} ${r.weight}%`)
        .join(", ")}.`,
      importance: 4,
    });
    return [
      `Your portfolio is worth ${inr(value)} with ${inr(pnl)} unrealised P&L.`,
      heavy.length
        ? `${heavy.map((h) => `${h.symbol} (${h.weight}%)`).join(", ")} ${heavy.length === 1 ? "is" : "are"} above the 10% single-position guideline; consider trimming.`
        : "No single position is above 10%, so concentration looks fine.",
      `Ask me to backtest a strategy or to buy or sell something.${note}`,
    ].join("\n\n");
  }

  if (!tools.size) return mockReplyText(text);
  await ui("show_card", {
    title: "What I can do",
    tone: "info",
    fields: [
      { label: "Portfolio review", value: "“Review my portfolio”" },
      { label: "Backtest", value: "“Backtest 120-day momentum”" },
      { label: "Trade", value: "“Buy 10 INFY”" },
    ],
  });
  return `I can review your Zerodha portfolio, research stocks, backtest momentum strategies, and prepare orders for you to confirm.${note}`;
}
