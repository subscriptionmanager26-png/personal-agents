import { completeKiteMcpOAuth, kiteMcpBearer } from "@/lib/kite-mcp-oauth";
import { apiError, readJson, requireCompany } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** Complete OAuth after redirect to pocketedge.in (company API key only). */
export async function POST(request: Request) {
  const auth = await requireCompany(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? body.code : "";
  const state = typeof body?.state === "string" ? body.state : "";
  if (!code || !state) return apiError(400, "invalid_request", "code and state required.");
  try {
    await completeKiteMcpOAuth({ code, state });
    const ready = Boolean(await kiteMcpBearer());
    return Response.json({ ok: true, ready });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token exchange failed.";
    return apiError(502, "kite_mcp_oauth_failed", message);
  }
}