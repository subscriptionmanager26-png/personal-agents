import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppNav, type NavLink } from "@/components/app-nav";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isOperator } from "@/lib/config";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

function CreateWorkspace() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Set up your business</h1>
        <p className="mt-1 text-muted-foreground">
          Your clients will sign up through your link, and you approve each one before their
          personal agent starts.
        </p>
      </div>
      <Suspense>
        <QueryError />
      </Suspense>
      <form action="/app/setup/create" method="post" className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">Business name</Label>
          <Input id="name" name="name" required placeholder="Acme Wealth Advisors" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slug">Signup link name</Label>
          <Input id="slug" name="slug" placeholder="acme-wealth" />
          <p className="text-xs text-muted-foreground">Clients sign up at /join/&lt;link name&gt;.</p>
        </div>
        <Button type="submit">Create workspace</Button>
      </form>
    </div>
  );
}

function Waiting({ workspaceName, suspended }: { workspaceName?: string; suspended: boolean }) {
  return (
    <div className="mx-auto max-w-lg space-y-2">
      <h1 className="font-heading text-3xl tracking-tight">
        {suspended ? "Access paused" : "Waiting for approval"}
      </h1>
      <p className="text-muted-foreground">
        {suspended
          ? `${workspaceName || "The workspace owner"} has paused your agent. Contact them to restore access.`
          : `${workspaceName || "The workspace owner"} will review your signup. Your personal agent will be ready here once you're approved.`}
      </p>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/");
  const { user, workspace, isOwner } = viewer;

  let body = children;
  let links: NavLink[] = [];
  if (!workspace) {
    body = <CreateWorkspace />;
  } else if (!isOwner && user.membershipStatus !== "active") {
    body = <Waiting workspaceName={workspace.name} suspended={user.membershipStatus === "suspended"} />;
  } else {
    links = isOwner
      ? [
          { href: "/app/chat", label: "Chat" },
          { href: "/app/clients", label: "Clients" },
          { href: "/app/skills", label: "Skills" },
          { href: "/app/workspace", label: "Workspace" },
          { href: "/app/connections", label: "Connections" },
        ]
      : [
          { href: "/app/chat", label: "Chat" },
          { href: "/app/connections", label: "Connections" },
        ];
  }
  if (isOperator(user)) links.push({ href: "/app/admin", label: "Monitor" });

  return (
    <div className="flex min-h-full flex-1 flex-col bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background),var(--chart-2)_5%),var(--background)_240px)]">
      <AppNav
        displayName={user.displayName || user.email}
        workspaceName={workspace?.name}
        links={links}
        showSettings={links.length > 0}
      />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{body}</div>
    </div>
  );
}
