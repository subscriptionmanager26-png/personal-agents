import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isMockCursor } from "@/lib/config";
import { requestOrigin } from "@/lib/request-origin";
import { getViewer } from "@/lib/viewer";
import { canUseAgent, listClients } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/");
  const { user, workspace, isOwner } = viewer;
  // Layout renders setup / waiting screens for everyone else.
  if (!workspace || !canUseAgent(user)) return null;
  if (!isOwner) redirect("/app/chat");

  const clients = await listClients(user.id, workspace.id);
  const pending = clients.filter((c) => c.membershipStatus === "pending").length;
  const active = clients.filter((c) => c.membershipStatus === "active").length;
  const origin = requestOrigin(new Request("http://local", { headers: await headers() }));
  const joinUrl = `${origin}/join/${workspace.slug}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">{workspace.name}</h1>
        <p className="mt-1 text-muted-foreground">
          Each approved client gets a private agent with your skills and instructions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client signup link</CardTitle>
          <CardDescription>Share this on your site. You approve each signup.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block break-all rounded-md bg-muted px-3 py-2 text-sm">{joinUrl}</code>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/app/clients">
          <Card className="h-full transition hover:border-foreground/30">
            <CardHeader>
              <CardTitle>Clients</CardTitle>
              <CardDescription>
                {active} active
                {pending ? ` · ${pending} waiting for approval` : ""}
              </CardDescription>
            </CardHeader>
            {pending > 0 && (
              <CardContent>
                <Badge>Review {pending}</Badge>
              </CardContent>
            )}
          </Card>
        </Link>
        <Link href="/app/skills">
          <Card className="h-full transition hover:border-foreground/30">
            <CardHeader>
              <CardTitle>Skills</CardTitle>
              <CardDescription>
                {workspace.skills.length
                  ? `${workspace.skills.length} skill${workspace.skills.length === 1 ? "" : "s"} given to every agent`
                  : "No skills yet. Add your playbooks."}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/app/workspace">
          <Card className="h-full transition hover:border-foreground/30">
            <CardHeader>
              <CardTitle>Agent instructions</CardTitle>
              <CardDescription>
                {workspace.instructions ? "Set" : "Not set"} · memory guidance{" "}
                {workspace.memoryGuidance ? "set" : "not set"} ·{" "}
                {workspace.suggestedConnections.length} suggested connections
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {isMockCursor() && (
        <p className="text-xs text-muted-foreground">
          Running without a Cursor API key: agent replies are simulated.
        </p>
      )}
    </div>
  );
}
