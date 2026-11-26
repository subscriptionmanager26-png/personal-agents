import { beginKiteMcpOAuth, kiteMcpBearer } from "@/lib/kite-mcp-oauth";
import { apiError, requireCompany } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** Pocketedge BFF starts operator OAuth with the company API key (no studio session). */
export async function GET(request: Request) {
  const auth = await requireCompany(request);
  if ("response" in auth) return auth.response;
  const bearer = await kiteMcpBearer();
  if (bearer) {
    return Response.json({ ready: true });
  }
  try {
    const { url } = await beginKiteMcpOAuth();
    return Response.json({ ready: false, url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Kite MCP OAuth.";
    return apiError(502, "kite_mcp_oauth_start_failed", message);
  }
}