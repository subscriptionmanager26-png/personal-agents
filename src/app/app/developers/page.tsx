import { headers } from "next/headers";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockCompanyServersEnabled } from "@/lib/mock-company";
import { requestOrigin } from "@/lib/request-origin";
import { requireOwner } from "@/lib/viewer";

import { CreateApiKey, SigningSecret } from "./secret-tools";

export const dynamic = "force-dynamic";

const ENDPOINTS: [string, string, string][] = [
  ["PUT", "/api/v1/users/{userId}", "Create or update a user's agent. Body: { name?, email? }. 201 when created."],
  ["GET", "/api/v1/users/{userId}", "The user and whether their agent is active."],
  ["DELETE", "/api/v1/users/{userId}", "Disable the agent (history and memory are kept; PUT re-enables)."],
  ["POST", "/api/v1/users/{userId}/messages", "Send { text, threadId? }. 202 with the message and its events URL. 409 agent_busy while a reply is in progress."],
  ["GET", "/api/v1/users/{userId}/messages/{id}/events", "Server-sent events for that message (see below). Resume with Last-Event-ID or ?after=<seq>."],
  ["GET", "/api/v1/users/{userId}/messages/{id}", "The message with all blocks and actions, for redrawing."],
  ["GET", "/api/v1/users/{userId}/messages?threadId=&limit=", "History, newest first."],
  ["GET", "/api/v1/users/{userId}/orders", "Order proposals and their outcomes."],
  ["POST", "/api/v1/users/{userId}/orders/{orderId}", "Report the outcome: { status: rejected } or, after your backend placed it, { status: executed, brokerOrderId } / { status: failed, message }."],
];

const EVENTS = `event: status           {"seq":2,"type":"status","label":"Fetching your holdings"}
event: block            {"seq":3,"type":"block","block":{"kind":"table","title":"Holdings","columns":[{"key":"symbol","label":"Symbol"}…],"rows":[…]}}
event: block            {"seq":4,"type":"block","block":{"kind":"chart","chartType":"line","xKey":"date","series":[…],"data":[…]}}
event: block            {"seq":5,"type":"block","block":{"kind":"card","title":"…","tone":"success","fields":[{"label":"CAGR","value":"18.2%"}]}}
event: action_required  {"seq":6,"type":"action_required","action":{"kind":"connection_login","service":"Zerodha","url":"https://…"}}
event: action_required  {"seq":7,"type":"action_required","action":{"kind":"order_confirmation","orderId":"ord_…","order":{"exchange":"NSE","symbol":"INFY","side":"BUY","quantity":10,"orderType":"LIMIT","price":1525,"product":"CNC"},"rationale":"…","expiresAt":"…"}}
event: block            {"seq":8,"type":"block","block":{"kind":"markdown","text":"Final answer…"}}
event: done             {"seq":9,"type":"done"}        (or  event: error {"type":"error","message":"…"})`;

export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireOwner();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const origin = requestOrigin(new Request("http://local", { headers: await headers() }));
  const keys = workspace.apiKeys ?? [];
  const servers = workspace.companyServers ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Developers</h1>
        <p className="mt-1 text-muted-foreground">
          Your backend gives each of your users a private agent and renders its replies in your
          own UI. Base URL: <code>{origin}</code>
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Send as <code>Authorization: Bearer pa_…</code> from your backend only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {keys.length > 0 && (
            <ul className="space-y-2">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{k.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      pa_{k.id}_… · created {new Date(k.createdAt).toLocaleDateString()} ·{" "}
                      {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}
                    </p>
                  </div>
                  <form action="/app/developers/keys/revoke" method="post">
                    <input type="hidden" name="id" value={k.id} />
                    <Button variant="ghost" size="sm" type="submit">
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <CreateApiKey />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your MCP servers</CardTitle>
          <CardDescription>
            Attached to every user&apos;s agent, e.g. your backtesting engine and your Zerodha
            integration. Each call carries a token saying which user it is for (see below). Expose
            only read-only broker tools: orders go through order proposals.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {servers.length > 0 && (
            <ul className="space-y-2">
              {servers.map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{s.name}</p>
                    <p className="break-all font-mono text-xs text-muted-foreground">{s.url}</p>
                    {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  </div>
                  <form action="/app/developers/servers/delete" method="post">
                    <input type="hidden" name="id" value={s.id} />
                    <Button variant="ghost" size="sm" type="submit">
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action="/app/developers/servers/add" method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-name">Name</Label>
                <Input id="s-name" name="name" required placeholder="backtest" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="s-url">MCP URL (Streamable HTTP)</Label>
                <Input id="s-url" name="url" required placeholder="https://mcp.yourcompany.com/backtest" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-desc">What it&apos;s for (shown to the agent)</Label>
              <Input id="s-desc" name="description" placeholder="Momentum backtests on NSE stocks" />
            </div>
            <Button type="submit" variant="outline">
              Add server
            </Button>
          </form>
          {mockCompanyServersEnabled() && (
            <p className="text-xs text-muted-foreground">
              Local mocks: <code>{origin}/api/mock/zerodha</code> (read-only holdings and quotes,
              daily login) and <code>{origin}/api/mock/backtest</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>User tokens for your MCP servers</CardTitle>
          <CardDescription>
            Every call to your servers has <code>Authorization: Bearer &lt;JWT&gt;</code>, HS256-signed
            with this secret. Verify the signature, <code>iss = &quot;personal-agents&quot;</code> and{" "}
            <code>aud = &lt;server name&gt;</code>; <code>sub</code> is your user id and <code>ws</code>{" "}
            is <code>{workspace.slug}</code>. Tokens last 3 hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SigningSecret exists={Boolean(workspace.mcpSigningSecretEnc)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API reference</CardTitle>
          <CardDescription>
            <code>userId</code> is your own user id (letters, digits, <code>. _ : @ -</code>). Users can
            only ever reach their own agent, memory and orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <table className="w-full text-left">
            <tbody>
              {ENDPOINTS.map(([method, path, doc]) => (
                <tr key={method + path} className="border-b border-border/60 align-top last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs font-semibold">{method}</td>
                  <td className="py-2 pr-3 font-mono text-xs break-all">{path}</td>
                  <td className="py-2 text-muted-foreground">{doc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="mb-2 font-medium">Event stream</p>
            <p className="mb-2 text-muted-foreground">
              Render each <code>block</code> with your own components, in order. Show{" "}
              <code>status</code> as progress. For <code>order_confirmation</code>, show the order with
              Confirm / Reject; on Confirm your backend places it with Zerodha and reports the
              outcome. The agent sees the result on its next message.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">{EVENTS}</pre>
          </div>
          <div>
            <p className="mb-2 font-medium">Quick start</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">{`curl -X PUT ${origin}/api/v1/users/user_8812 \\
  -H "Authorization: Bearer $PA_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Priya"}'

curl -X POST ${origin}/api/v1/users/user_8812/messages \\
  -H "Authorization: Bearer $PA_KEY" -H "Content-Type: application/json" \\
  -d '{"text":"Review my portfolio"}'

curl -N ${origin}/api/v1/users/user_8812/messages/<messageId>/events \\
  -H "Authorization: Bearer $PA_KEY"`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
