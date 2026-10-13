import { authorizeAgentCaller } from "@/lib/agent-mcp";
import { appendStreamEvents, getJob } from "@/lib/jobs";
import {
  getKiteConnection,
  KITE_BLOCKED_TOOLS,
  KITE_MCP_NAME,
  kiteCall,
  kiteLoggedInAs,
  kiteLogin,
  kiteTools,
  toolResultText,
} from "@/lib/kite";
import { handleMcpBody, toolText, type ToolResult } from "@/lib/mcp-server";

/** Zerodha asks clients to show this before an AI uses their account. */
const LOGIN_WARNING =
  "AI systems are unpredictable. By logging in you agree to let your assistant read your Zerodha account at your own risk.";
const NEEDS_LOGIN = /log ?in first|login required|not logged in|session (has )?expired|invalid (access )?token/i;
/** Kite hides why a call failed (no login, expired login, bad input), so a failure may still mean "log in". */
const MAYBE_LOGIN = /^Failed to execute /;

function message(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/** Shows the client a "Log in to Zerodha" button on this message (once) and tells the agent to wait for them. */
async function askToLogIn(ownerUserId: string, jobId: string): Promise<ToolResult> {
  const login = await kiteLogin(ownerUserId);
  if ("loggedInAs" in login) return message(`Logged in to Zerodha as ${login.loggedInAs}. Retry the call.`);
  const job = await getJob(jobId);
  const shown =
    job?.stream?.some((e) => e.type === "action_required" && e.action.kind === "connection_login" && e.action.service === "Zerodha") ||
    Boolean(
      (
        await appendStreamEvents(jobId, ownerUserId, [
          { type: "action_required", action: { kind: "connection_login", service: "Zerodha", url: login.url, message: LOGIN_WARNING } },
        ])
      )?.length,
    );
  if (!shown) {
    return message("Zerodha login needed. Ask the client to log in to Zerodha from their Connections page, then send their message again.", true);
  }
  return message(
    "Zerodha login needed. The client now sees a 'Log in to Zerodha' button in the app. Tell them to log in there and send their message again; the login lasts the trading day. Never share login links yourself.",
    true,
  );
}

/** MCP endpoint for the agent: the client's own Zerodha account through their saved Kite session. */
export async function handleKiteRpc(bearer: string, body: unknown) {
  const caller = await authorizeAgentCaller(bearer);
  if (!caller) return { status: 401, json: { error: "unauthorized" } };
  const { ownerUserId, jobId } = caller;
  if (!(await getKiteConnection(ownerUserId))) return { status: 404, json: { error: "zerodha_not_connected" } };

  return handleMcpBody(
    {
      name: KITE_MCP_NAME,
      instructions: () =>
        "The client's own Zerodha account (read-only): profile, holdings, mutual funds, positions, margins, orders and trades, quotes and historical prices. Orders cannot be placed, changed or cancelled here; to trade, use propose_order so the client confirms.",
      tools: () => kiteTools(ownerUserId).catch(() => []),
      call: async (name, args) => {
        if (KITE_BLOCKED_TOOLS.has(name)) {
          return toolText({ error: "Trading is disabled on this connection. To buy or sell, use propose_order so the client can confirm." }, true);
        }
        try {
          if (name === "login") return await askToLogIn(ownerUserId, jobId);
          const result = await kiteCall(ownerUserId, name, args);
          if (!result.isError) return result;
          const text = toolResultText(result);
          if (NEEDS_LOGIN.test(text)) return await askToLogIn(ownerUserId, jobId);
          if (MAYBE_LOGIN.test(text) && !(await kiteLoggedInAs(ownerUserId))) return await askToLogIn(ownerUserId, jobId);
          return result;
        } catch (error) {
          return toolText({ error: error instanceof Error ? error.message : "Zerodha request failed." }, true);
        }
      },
    },
    body,
  );
}
