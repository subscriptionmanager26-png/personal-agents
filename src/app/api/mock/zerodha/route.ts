import { handleMcpBody, mcpRoute, toolText } from "@/lib/mcp-server";
import {
  hasBrokerSession,
  mockCompanyServersEnabled,
  mockHoldings,
  mockQuote,
  verifyMockCaller,
} from "@/lib/mock-company";
import { requestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

const PATH = "/api/mock/zerodha";

/** Read-only mock of a company's Zerodha MCP. Order placement is deliberately absent. */
export async function POST(request: Request) {
  if (!mockCompanyServersEnabled()) return new Response(null, { status: 404 });
  const origin = requestOrigin(request);
  return mcpRoute(request, async (bearer, body) => {
    const caller = await verifyMockCaller(bearer, PATH);
    if (!caller) return { status: 401, json: { error: "invalid user token" } };
    const loginRequired = () =>
      toolText(
        {
          error: "session_expired",
          message: "The client's Zerodha session has expired. Ask them to log in.",
          login_url: `${origin}${PATH}/login?t=${encodeURIComponent(bearer)}`,
        },
        true,
      );
    return handleMcpBody(
      {
        name: "zerodha",
        instructions: () => "Read-only Zerodha (Kite) data for the signed-in client. Sessions expire daily.",
        tools: [
          {
            name: "get_holdings",
            description: "The client's long-term holdings with quantity, average price, last price and P&L.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "get_quote",
            description: "Latest price for an NSE symbol.",
            inputSchema: { type: "object", required: ["symbol"], properties: { symbol: { type: "string" } } },
          },
        ],
        call: async (name, args) => {
          if (name === "get_holdings") {
            if (!hasBrokerSession(caller.workspaceId, caller.userId)) return loginRequired();
            return toolText({ holdings: mockHoldings(caller.userId) });
          }
          if (name === "get_quote") {
            const quote = mockQuote(String(args.symbol ?? ""));
            return quote ? toolText(quote) : toolText({ error: "unknown symbol" }, true);
          }
          return undefined;
        },
      },
      body,
    );
  });
}
