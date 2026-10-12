import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentBlock } from "@/components/agent-blocks";
import { MemoryList } from "@/components/memory-list";
import { messageView } from "@/lib/agent-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listJobsForUser } from "@/lib/jobs";
import { listMemories } from "@/lib/memory";
import { appendAudit } from "@/lib/users";
import { requireOwner } from "@/lib/viewer";
import { getClientForOwner } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireOwner();
  const { id } = await params;
  const client = await getClientForOwner(user.id, decodeURIComponent(id));
  if (!client) notFound();

  await appendAudit({
    ownerUserId: client.id,
    type: "owner.view_client",
    detail: `Workspace owner ${user.id} viewed chats and memory`,
  });
  const [jobs, memories] = await Promise.all([listJobsForUser(client.id, 60), listMemories(client.id)]);
  const timeline = [...jobs].reverse();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/clients" className="text-sm text-muted-foreground hover:text-foreground">
          ← Clients
        </Link>
        <h1 className="mt-2 font-heading text-3xl tracking-tight">{client.displayName || client.email || client.externalId}</h1>
        <p className="mt-1 text-muted-foreground">
          Read-only. This view is logged. Saved logins and connection keys are never shown.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Chats</CardTitle>
          <CardDescription>Last {jobs.length} messages</CardDescription>
        </CardHeader>
        <CardContent>
          {!timeline.length ? (
            <p className="text-sm text-muted-foreground">No chats yet.</p>
          ) : (
            <ul className="space-y-4">
              {timeline.map((job) => (
                <li key={job.id} className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</p>
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">
                    <p className="whitespace-pre-wrap">{job.prompt}</p>
                  </div>
                  {job.stream?.some((e) => e.type === "block") ? (
                    <div className="mr-auto max-w-[92%] space-y-2">
                      {messageView(job).blocks.map((b, i) => (
                        <AgentBlock key={i} block={b} />
                      ))}
                      {messageView(job).actions.map((a, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {a.kind === "order_confirmation"
                            ? `Order proposed: ${a.order.side} ${a.order.quantity} ${a.order.symbol}`
                            : `Asked to log in to ${a.service}`}
                        </p>
                      ))}
                    </div>
                  ) : job.reply?.message ? (
                    <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-border/70 bg-muted/40 px-3 py-2">
                      <p className="whitespace-pre-wrap">{job.reply.message}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{job.error || job.status}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent memory</CardTitle>
          <CardDescription>{memories.length} notes</CardDescription>
        </CardHeader>
        <CardContent>
          <MemoryList memories={memories} deletable={false} />
        </CardContent>
      </Card>
    </div>
  );
}
