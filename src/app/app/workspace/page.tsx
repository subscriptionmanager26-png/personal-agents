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
import { Textarea } from "@/components/ui/textarea";
import { requestOrigin } from "@/lib/request-origin";
import { requireOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireOwner();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const saved = params.saved === "1";
  const origin = requestOrigin(new Request("http://local", { headers: await headers() }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Workspace</h1>
        <p className="mt-1 text-muted-foreground">
          How every client&apos;s agent behaves. Clients never see these instructions.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}

      <Card>
        <CardHeader>
          <CardTitle>Client signup link</CardTitle>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded-md bg-muted px-3 py-2 text-sm">
            {origin}/join/{workspace.slug}
          </code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent instructions</CardTitle>
          <CardDescription>
            Who the agent works for, its tone, what it must never do (e.g. &quot;never place
            trades&quot;, &quot;add the standard disclaimer to recommendations&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/app/workspace/update" method="post" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Business name</Label>
              <Input id="name" name="name" required defaultValue={workspace.name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="instructions">Instructions</Label>
              <Textarea
                id="instructions"
                name="instructions"
                rows={8}
                defaultValue={workspace.instructions}
                placeholder="You are a research assistant for clients of Acme Wealth. Be concise. Never execute trades. End any recommendation with: This is not investment advice."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="memoryGuidance">What should agents remember about clients?</Label>
              <Textarea
                id="memoryGuidance"
                name="memoryGuidance"
                rows={5}
                defaultValue={workspace.memoryGuidance}
                placeholder="Most important: goals, risk tolerance, time horizon, tax situation. Track holdings changes and decisions with dates. Small talk is not worth remembering."
              />
              <p className="text-xs text-muted-foreground">
                Agents save memory on their own after every chat and decide what matters; this
                steers them.
              </p>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suggested connections</CardTitle>
          <CardDescription>
            MCP servers your clients can connect with one click, e.g. a broker&apos;s or your own
            portfolio API. Each client connects with their own key, which you never see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {workspace.suggestedConnections.length > 0 && (
            <ul className="space-y-2">
              {workspace.suggestedConnections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="break-all font-mono text-xs text-muted-foreground">{c.url}</p>
                    {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                    {c.authHeader && (
                      <p className="text-xs text-muted-foreground">Client provides: {c.authHeader}</p>
                    )}
                  </div>
                  <form action="/app/workspace/connections/delete" method="post">
                    <input type="hidden" name="id" value={c.id} />
                    <Button variant="ghost" size="sm" type="submit">
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action="/app/workspace/connections/add" method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sc-name">Name</Label>
                <Input id="sc-name" name="name" required placeholder="Broker portfolio" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sc-url">MCP URL</Label>
                <Input id="sc-url" name="url" required placeholder="https://mcp.broker.com/mcp" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sc-header">Auth header clients fill in (optional)</Label>
                <Input id="sc-header" name="authHeader" placeholder="Authorization" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sc-desc">Note for clients (optional)</Label>
                <Input id="sc-desc" name="description" placeholder="Paste your read-only API key" />
              </div>
            </div>
            <Button type="submit" variant="outline">
              Add suggestion
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
