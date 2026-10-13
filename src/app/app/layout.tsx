import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppFrame } from "@/components/app-frame";
import { AppSidebar, type SidebarLink } from "@/components/app-sidebar";
import { QueryError } from "@/components/query-error";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isOperator } from "@/lib/config";
import { listChatThreads, type ChatThread } from "@/lib/threads";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

function CreateWorkspace() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Set up your business</h1>
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
      <h1 className="text-2xl font-semibold tracking-tight">
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
  let links: SidebarLink[] = [];
  let footerLinks: SidebarLink[] = [];
  let threads: ChatThread[] | undefined;
  if (!workspace) {
    body = <CreateWorkspace />;
  } else if (!isOwner && user.membershipStatus !== "active") {
    body = <Waiting workspaceName={workspace.name} suspended={user.membershipStatus === "suspended"} />;
  } else if (isOwner) {
    links = [
      { href: "/app", label: "Overview", icon: "overview" },
      { href: "/app/console", label: "Console", icon: "console" },
      { href: "/app/clients", label: "Users", icon: "users" },
      { href: "/app/skills", label: "Skills", icon: "skills" },
      { href: "/app/workspace", label: "Agent settings", icon: "settings" },
      { href: "/app/developers", label: "Developers", icon: "developers" },
    ];
  } else {
    threads = await listChatThreads(user.id);
    footerLinks = [{ href: "/app/connections", label: "Connections", icon: "connections" }];
  }
  if (isOperator(user)) links.push({ href: "/app/admin", label: "Monitor", icon: "monitor" });

  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  return (
    <SidebarProvider defaultOpen={sidebarState !== "false"} className="h-svh">
      <AppSidebar
        workspaceName={workspace?.name || "Personal Agents"}
        roleLabel={isOwner ? "Owner" : workspace ? "Personal agent" : "Getting started"}
        links={links}
        footerLinks={footerLinks}
        threads={threads}
        user={{ name: user.displayName || user.email || "You", email: user.email }}
        showSettings={Boolean(workspace) && (isOwner || user.membershipStatus === "active")}
      />
      <SidebarInset data-scroll-root className="min-h-0 overflow-y-auto scrollbar-thin">
        <AppFrame>{body}</AppFrame>
      </SidebarInset>
    </SidebarProvider>
  );
}
