import { apiError, readJson, requireApiUser } from "@/lib/api-auth";
import { connectKite, disconnectKite, getKiteConnection, kiteHoldings, kiteLogin } from "@/lib/kite";

export const dynamic = "force-dynamic";
/** Login is one RPC; holdings may paginate several get_holdings calls. */
export const maxDuration = 60;
export const preferredRegion = ["bom1"];

type Params = { params: Promise<{ userId: string }> };

/** Connect, disconnect, login, or fetch holdings for API (www) clients. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "connect") {
    const t0 = Date.now();
    // Enable Kite row, then open MCP session + login URL in one shot.
    await connectKite(auth.user.id);
    try {
      const login = await kiteLogin(auth.user.id);
      console.info("[zerodha] connect ok", { userId: auth.user.id, ms: Date.now() - t0, hasUrl: "url" in login });
      if ("url" in login) return Response.json({ ok: true, url: login.url });
      return Response.json({ ok: true, loggedInAs: login.loggedInAs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start Zerodha login.";
      console.error("[zerodha] connect/login failed", { userId: auth.user.id, ms: Date.now() - t0, message });
      return apiError(502, "zerodha_login_failed", message);
    }
  }
  if (action === "disconnect") {
    await disconnectKite(auth.user.id);
    return Response.json({ ok: true });
  }
  if (action === "login") {
    const t0 = Date.now();
    try {
      const login = await kiteLogin(auth.user.id);
      console.info("[zerodha] login ok", { userId: auth.user.id, ms: Date.now() - t0, hasUrl: "url" in login });
      if ("url" in login) return Response.json({ url: login.url });
      return Response.json({ loggedInAs: login.loggedInAs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start Zerodha login.";
      console.error("[zerodha] login failed", { userId: auth.user.id, ms: Date.now() - t0, message });
      return apiError(502, "zerodha_login_failed", message);
    }
  }
  if (action === "holdings") {
    const t0 = Date.now();
    if (!(await getKiteConnection(auth.user.id))) {
      return apiError(404, "zerodha_not_connected", "Connect Zerodha first.");
    }
    try {
      const result = await kiteHoldings(auth.user.id);
      if ("needsLogin" in result) {
        console.info("[zerodha] holdings need login", { userId: auth.user.id, ms: Date.now() - t0 });
        return Response.json(
          {
            needsLogin: true,
            error: { code: "zerodha_login_required", message: result.message },
          },
          { status: 401 },
        );
      }
      console.info("[zerodha] holdings ok", {
        userId: auth.user.id,
        ms: Date.now() - t0,
        count: result.holdings.length,
      });
      return Response.json({ ok: true, holdings: result.holdings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not fetch Zerodha holdings.";
      console.error("[zerodha] holdings failed", { userId: auth.user.id, ms: Date.now() - t0, message });
      return apiError(502, "zerodha_holdings_failed", message);
    }
  }
  return apiError(400, "invalid_action", "action must be connect, disconnect, login, or holdings.");
}
