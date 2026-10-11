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
import { getSession } from "@/lib/session";
import { listVaultItems } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const session = await getSession();
  if (!session) return null;
  const items = await listVaultItems(session.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Vault</h1>
        <p className="mt-1 text-muted-foreground">
          Model-blind credentials (Hermes / OpenInstinct style). The agent sees
          only opaque handles. Browser autofill uses MCP{" "}
          <code>vault_fill</code>; API calls use the vault HTTP proxy. Secrets
          never go into the chat prompt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add credential</CardTitle>
          <CardDescription>
            AES-256-GCM at rest. Optional origin binds the secret to one host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/app/vault/create" method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  name="label"
                  placeholder="broker-api"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="username">Username (optional)</Label>
                <Input id="username" name="username" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="origin">Bound origin (optional)</Label>
              <Input
                id="origin"
                name="origin"
                placeholder="https://api.broker.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="secret">Password / secret</Label>
              <Input
                id="secret"
                name="secret"
                type="password"
                required
                autoComplete="new-password"
              />
            </div>
            <Button type="submit">Encrypt &amp; save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stored handles</CardTitle>
        </CardHeader>
        <CardContent>
          {!items.length ? (
            <p className="text-sm text-muted-foreground">Vault is empty.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      handle={item.id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.username ? `user ${item.username} · ` : ""}
                      {item.origin ? `origin ${item.origin} · ` : ""}
                      secret hidden
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
        </CardContent>
      </Card>
    </div>
  );
}
