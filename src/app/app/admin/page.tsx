import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isOperator } from "@/lib/config";
import { listAllJobs } from "@/lib/jobs";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { listUsers } from "@/lib/users";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isOperator(session)) notFound();

  const users = await listUsers();
  const jobs = await listAllJobs(40);
  const store = await getStore();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitor</h1>
        <p className="mt-1 text-muted-foreground">
          Control-plane overview across personal agents (operators only).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums tracking-tight">{users.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums tracking-tight">{jobs.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Slack installs</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tabular-nums tracking-tight">
            {Object.keys(store.slackInstalls || {}).length}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>Each row is an isolated personal agent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!users.length ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            users.map((u) => (
              <div
                key={u.id}
                className="rounded-md border border-border/70 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {u.displayName || u.email || u.slackUserId}
                  </span>
                  {u.cursorAgentId ? (
                    <Badge variant="secondary">agent</Badge>
                  ) : (
                    <Badge variant="outline">no agent yet</Badge>
                  )}
                  {u.provisionError && (
                    <Badge variant="destructive">provision error</Badge>
                  )}
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                  {u.id}
                </p>
                <p className="mt-1 text-xs break-all">
                  repo: {u.agentRepository || "—"} · {u.role || "no role"}
                  {u.workspaceId ? ` in ${u.workspaceId}` : ""} · {u.membershipStatus || "—"}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.map((j) => (
            <div
              key={j.id}
              className="rounded-md border border-border/60 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{j.status}</span>
                <span className="text-muted-foreground">{j.ownerUserId}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{j.prompt}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
