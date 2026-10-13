import { Badge } from "@/components/ui/badge";
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
import { listConnections } from "@/lib/connections";
import { getKiteConnection, kiteLoggedInAs } from "@/lib/kite";
import { runtimeFor } from "@/lib/runtime";
import { listVaultItems } from "@/lib/vault";
import { requireAgentUser } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** "unknown" when Zerodha is slow or down; the page must not hang on it. */
async function zerodhaStatus(ownerUserId: string) {
  if (!(await getKiteConnection(ownerUserId))) return { connected: false as const };
  const timeout = new Promise<"unknown">((resolve) => setTimeout(() => resolve("unknown"), 8000));
  const name = await Promise.race([kiteLoggedInAs(ownerUserId).catch(() => "unknown" as const), timeout]);
  return { connected: true as const, loggedInAs: name };
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, workspace } = await requireAgentUser();
  const [items, connections, zerodha] = await Promise.all([
    listVaultItems(user.id),
    listConnections(user.id),
    zerodhaStatus(user.id),
  ]);
  const zerodhaReachable = Boolean(runtimeFor(workspace).agentPublicUrl);
  const connectedSuggestions = new Set(connections.map((c) => c.suggestionId).filter(Boolean));
  const suggestions = (workspace?.suggestedConnections ?? []).filter((s) => !connectedSuggestions.has(s.id));
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-muted-foreground">
          Give your agent access to your accounts, either with a saved login or with an MCP
          integration. Your agent never sees the password or key itself, and nobody else
          {workspace ? `, including ${workspace.name},` : ""} can see them.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Zerodha
            {zerodha.connected &&
              (zerodha.loggedInAs === "unknown" ? (
                <Badge variant="outline">connected</Badge>
              ) : zerodha.loggedInAs ? (
                <Badge>logged in</Badge>
              ) : (
                <Badge variant="outline">login needed</Badge>
              ))}
          </CardTitle>
          <CardDescription>
            Let your agent read your Zerodha holdings, mutual funds, positions, orders and live
            prices through Zerodha&apos;s official Kite connection. It can&apos;t place or cancel
            orders there; any trade it suggests waits for your confirmation. You log in on
            Zerodha&apos;s own page, once per trading day.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {zerodha.connected && zerodha.loggedInAs && zerodha.loggedInAs !== "unknown" && (
            <p>Logged in as {zerodha.loggedInAs}.</p>
          )}
          {zerodha.connected && !zerodha.loggedInAs && (
            <p className="text-muted-foreground">
              Your Zerodha login has expired. Log in again so your agent can read your account.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            AI systems are unpredictable. By logging in you let your agent read your Zerodha
            account at your own risk.
          </p>
          {!zerodhaReachable && user.role !== "client" && (
            <p className="text-xs text-destructive">
              Agents can only use Zerodha once this workspace has a public URL (Developers → Agent
              runtime).
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!zerodha.connected ? (
              <form action="/app/connections/zerodha" method="post" target="_blank">
                <input type="hidden" name="action" value="connect" />
                <Button size="sm" type="submit">
                  Connect Zerodha
                </Button>
              </form>
            ) : (
              <>
                {(!zerodha.loggedInAs || zerodha.loggedInAs === "unknown") && (
                  <form action="/app/connections/zerodha" method="post" target="_blank">
                    <input type="hidden" name="action" value="login" />
                    <Button size="sm" type="submit">
                      Log in to Zerodha
                    </Button>
                  </form>
                )}
                <form action="/app/connections/zerodha" method="post">
                  <input type="hidden" name="action" value="disconnect" />
                  <Button size="sm" variant="ghost" type="submit">
                    Disconnect
                  </Button>
                </form>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Suggested by {workspace?.name}</CardTitle>
            <CardDescription>One-click integrations.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {suggestions.map((s) => (
                <li key={s.id} className="rounded-md border border-border/70 px-3 py-3 text-sm">
                  <form action="/app/connections/add" method="post" className="space-y-2">
                    <input type="hidden" name="suggestionId" value={s.id} />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{s.name}</p>
                        {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                      </div>
                      {!s.authHeader && (
                        <Button size="sm" type="submit">
                          Connect
                        </Button>
                      )}
                    </div>
                    {s.authHeader && (
                      <div className="flex gap-2">
                        <Input
                          name="headerValue"
                          type="password"
                          required
                          autoComplete="off"
                          placeholder={`${s.authHeader} value${s.authHeader.toLowerCase() === "authorization" ? ", e.g. Bearer …" : ""}`}
                        />
                        <Button size="sm" type="submit">
                          Connect
                        </Button>
                      </div>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Integrations (MCP)</CardTitle>
          <CardDescription>
            Keys are encrypted and only attached when your agent calls the integration; the agent
            never sees them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connections.length > 0 && (
            <ul className="space-y-2">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {c.name}
                      {c.hasSecret && <Badge variant="outline">key saved</Badge>}
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">{c.url}</p>
                  </div>
                  <form action="/app/connections/delete" method="post">
                    <input type="hidden" name="id" value={c.id} />
                    <Button variant="ghost" size="sm" type="submit">
                      Disconnect
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action="/app/connections/add" method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Name</Label>
                <Input id="c-name" name="name" required placeholder="my-broker" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-url">MCP server URL</Label>
                <Input id="c-url" name="url" required placeholder="https://mcp.example.com/mcp" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-header">Auth header (optional)</Label>
                <Input id="c-header" name="headerName" placeholder="Authorization" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-value">Header value (optional)</Label>
                <Input id="c-value" name="headerValue" type="password" autoComplete="off" placeholder="Bearer …" />
              </div>
            </div>
            <Button type="submit" variant="outline">
              Add integration
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved logins</CardTitle>
          <CardDescription>
            For sites without an integration. Your agent signs in with the browser; the password
            is filled in without the agent ever reading it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.username ? `${item.username} · ` : ""}
                      {item.origin || "any site"} · password hidden
                    </p>
                  </div>
                  <form action="/app/vault/delete" method="post">
                    <input type="hidden" name="id" value={item.id} />
                    <Button variant="ghost" size="sm" type="submit">
                      Delete
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action="/app/vault/create" method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="label">Label</Label>
                <Input id="label" name="label" placeholder="Zerodha" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="origin">Login page site</Label>
                <Input id="origin" name="origin" placeholder="https://kite.zerodha.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input id="username" name="username" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="secret">Password</Label>
                <Input id="secret" name="secret" type="password" required autoComplete="new-password" />
              </div>
            </div>
            <Button type="submit" variant="outline">
              Save login
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
