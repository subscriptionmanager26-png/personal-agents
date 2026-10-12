import { handleMcpBody, mcpRoute, toolText } from "@/lib/mcp-server";
import { mockBacktest, mockCompanyServersEnabled, verifyMockCaller } from "@/lib/mock-company";

export const dynamic = "force-dynamic";

/** Mock of a company's backtesting engine exposed over MCP. */
export async function POST(request: Request) {
  if (!mockCompanyServersEnabled()) return new Response(null, { status: 404 });
  return mcpRoute(request, async (bearer, body) => {
    const caller = await verifyMockCaller(bearer, "/api/mock/backtest");
    if (!caller) return { status: 401, json: { error: "invalid user token" } };
    return handleMcpBody(
      {
        name: "backtest",
        instructions: () => "Momentum strategy backtests on NSE symbols or the NIFTY50 universe.",
        tools: [
          {
            name: "run_backtest",
            description:
              "Backtest a momentum strategy: buy the strongest performers over lookback_days, rebalance every holding_days.",
            inputSchema: {
              type: "object",
              properties: {
                symbol: { type: "string", description: "NSE symbol, or NIFTY50 for the index universe (default)" },
                lookback_days: { type: "number", description: "Momentum window, default 90" },
                holding_days: { type: "number", description: "Rebalance interval, default 20" },
                years: { type: "number", description: "History length, default 3" },
              },
            },
          },
        ],
        call: async (name, args) =>
          name === "run_backtest"
            ? toolText(
                mockBacktest({
                  symbol: typeof args.symbol === "string" ? args.symbol : undefined,
                  lookback_days: typeof args.lookback_days === "number" ? args.lookback_days : undefined,
                  holding_days: typeof args.holding_days === "number" ? args.holding_days : undefined,
                  years: typeof args.years === "number" ? args.years : undefined,
                }),
              )
            : undefined,
      },
      body,
    );
  });
}
