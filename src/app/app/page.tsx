import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isMockCursor } from "@/lib/config";
import { listJobsForUser } from "@/lib/jobs";
import { getSession } from "@/lib/session";
import { activeBackend } from "@/lib/store";
import { getUser } from "@/lib/users";

export default async function AgentPage() {
  const session = await getSession();
  if (!session) return null;
  const user = await getUser(session.id);
  const jobs = await listJobsForUser(session.id, 15);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">My agent</h1>
        <p className="mt-1 text-muted-foreground">
          Standing Cursor agent bound to your email identity and personal repo.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>Canonical tenancy key</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">User id</span>
              <p className="font-mono text-xs break-all">{user?.id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Email</span>
              <p>{user?.email || session.email || "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runtime</CardTitle>
            <CardDescription>Cursor + GitHub binding</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">store:{activeBackend()}</Badge>
              {isMockCursor() ? (
                <Badge variant="outline">mock Cursor</Badge>
              ) : (
                <Badge>Cursor API</Badge>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Agent repo</span>
              <p className="break-all">
                {user?.agentRepository || "Not provisioned yet"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Cursor agent</span>
              <p className="font-mono text-xs break-all">
                {user?.cursorAgentId || "Created on first chat message"}
              </p>
            </div>
            {user?.provisionError && (
              <p className="text-destructive">{user.provisionError}</p>
            )}
            <div>
              <span className="text-muted-foreground">Enabled skills</span>
              <p>
                {(user?.enabledSkillIds || []).join(", ") || "None installed"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent jobs</CardTitle>
          <CardDescription>
            Only your jobs — never another person&apos;s
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!jobs.length ? (
            <p className="text-sm text-muted-foreground">
              No jobs yet. Open Chat and send your first message.
            </p>
          ) : (
            <ul className="space-y-3">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {job.status}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        via {job.source || "web"}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{job.prompt}</p>
                  {job.reply?.message && (
                    <p className="mt-2 whitespace-pre-wrap border-t border-border/60 pt-2">
                      {job.reply.message.slice(0, 600)}
                    </p>
                  )}
                  {job.error && (
                    <p className="mt-2 text-destructive">{job.error}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
