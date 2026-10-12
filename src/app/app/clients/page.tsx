import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MembershipStatus, PersonalUser } from "@/lib/types";
import { requireOwner } from "@/lib/viewer";
import { listClients } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

function StatusButton({ client, status, label, variant }: {
  client: PersonalUser;
  status: MembershipStatus;
  label: string;
  variant?: "default" | "outline" | "ghost";
}) {
  return (
    <form action="/app/clients/status" method="post">
      <input type="hidden" name="id" value={client.id} />
      <input type="hidden" name="status" value={status} />
      <Button size="sm" variant={variant} type="submit">
        {label}
      </Button>
    </form>
  );
}

function ClientRow({ client }: { client: PersonalUser }) {
  const status = client.membershipStatus ?? "pending";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          {client.displayName || client.email}
          {status !== "active" && <Badge variant="outline">{status}</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {client.email} · joined {new Date(client.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex gap-1">
        {status === "pending" && (
          <>
            <StatusButton client={client} status="active" label="Approve" />
            <StatusButton client={client} status="suspended" label="Decline" variant="ghost" />
          </>
        )}
        {status === "active" && (
          <>
            <Link
              href={`/app/clients/${encodeURIComponent(client.id)}`}
              className="inline-flex h-7 items-center rounded-md px-2.5 text-sm hover:bg-muted"
            >
              View
            </Link>
            <StatusButton client={client} status="suspended" label="Suspend" variant="ghost" />
          </>
        )}
        {status === "suspended" && (
          <StatusButton client={client} status="active" label="Reactivate" variant="outline" />
        )}
      </div>
    </li>
  );
}

export default async function ClientsPage() {
  const { user, workspace } = await requireOwner();
  const clients = await listClients(user.id, workspace.id);
  const groups: { title: string; description: string; items: PersonalUser[] }[] = [
    {
      title: "Waiting for approval",
      description: "Approve to give them a personal agent.",
      items: clients.filter((c) => (c.membershipStatus ?? "pending") === "pending"),
    },
    {
      title: "Active",
      description: "Each has a private agent. Viewing a client's chats is logged.",
      items: clients.filter((c) => c.membershipStatus === "active"),
    },
    {
      title: "Suspended",
      description: "Their agent stops answering until reactivated.",
      items: clients.filter((c) => c.membershipStatus === "suspended"),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Clients</h1>
        <p className="mt-1 text-muted-foreground">
          Clients sign up at <code>/join/{workspace.slug}</code>.
        </p>
      </div>
      {!clients.length && <p className="text-sm text-muted-foreground">No signups yet.</p>}
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <Card key={g.title}>
            <CardHeader>
              <CardTitle>
                {g.title} ({g.items.length})
              </CardTitle>
              <CardDescription>{g.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {g.items.map((c) => (
                  <ClientRow key={c.id} client={c} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
