import { apiError, readJson, requireApiUser } from "@/lib/api-auth";
import { connectKite, disconnectKite, kiteLogin } from "@/lib/kite";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

/** Connect, disconnect, or start Zerodha login for API (www) clients. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "connect") {
    await connectKite(auth.user.id);
    return Response.json({ ok: true });
  }
  if (action === "disconnect") {
    await disconnectKite(auth.user.id);
    return Response.json({ ok: true });
  }
  if (action === "login") {
    const login = await kiteLogin(auth.user.id);
    if ("url" in login) return Response.json({ url: login.url });
    return Response.json({ loggedInAs: login.loggedInAs });
  }
  return apiError(400, "invalid_action", "action must be connect, disconnect, or login.");
}
