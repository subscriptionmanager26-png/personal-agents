import { handleKiteRpc } from "@/lib/kite-mcp";
import { mcpRoute } from "@/lib/mcp-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return mcpRoute(request, handleKiteRpc);
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
