import { mockCompanyServersEnabled, startBrokerSession, verifyMockCaller } from "@/lib/mock-company";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#222">
<p style="color:#888;font-size:.8rem">Mock Zerodha login (local development)</p><h1 style="font-size:1.4rem">${title}</h1><p>${body}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request) {
  if (!mockCompanyServersEnabled()) return new Response(null, { status: 404 });
  const token = new URL(request.url).searchParams.get("t") || "";
  const caller = await verifyMockCaller(token, "/api/mock/zerodha");
  if (!caller) return page("Link expired", "Ask your agent again to get a fresh login link.", 401);
  startBrokerSession(caller.workspaceId, caller.userId);
  return page("Logged in to Zerodha", "You can close this tab and ask your agent again.");
}
