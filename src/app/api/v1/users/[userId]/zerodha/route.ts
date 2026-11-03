import { apiError, readJson, requireApiUser } from "@/lib/api-auth";
import { connectKite, disconnectKite, kiteLogin } from "@/lib/kite";

export const dynamic = "force-dynamic";
/** Connect opens a Kite MCP session then calls login — allow nested 30s RPCs. */
export const maxDuration = 90;

type Params = { params: Promise<{ userId: string }> };

/** Connect, disconnect, or start Zerodha login for API (www) clients. */
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
  return apiError(400, "invalid_action", "action must be connect, disconnect, or login.");
}
