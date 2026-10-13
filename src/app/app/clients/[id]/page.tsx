import Link from "next/link";
import { notFound } from "next/navigation";

import { AssistantMessage, UserMessage } from "@/components/chat/messages";
import { MemoryList } from "@/components/memory-list";
import { listOrderViews } from "@/lib/agent-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listJobsForUser } from "@/lib/jobs";
import { listMemories } from "@/lib/memory";
import { chatMessage } from "@/lib/threads";
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
  const [jobs, memories, orders] = await Promise.all([
    listJobsForUser(client.id, 60),
    listMemories(client.id),
    listOrderViews(client.id),
  ]);
  const orderStates = Object.fromEntries(orders.map((o) => [o.id, { status: o.status, brokerOrderId: o.brokerOrderId }]));
  const timeline = [...jobs].reverse();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/clients" className="text-sm text-muted-foreground hover:text-foreground">
          ← Users
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{client.displayName || client.email || client.externalId}</h1>
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
            <div className="space-y-8">
              {timeline.map((job) => {
                const message = chatMessage(job);
                return (
                  <section key={job.id} className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()} · {job.source === "api" ? "via API" : "web chat"}
                    </p>
                    <UserMessage text={message.text} attachments={message.attachments} />
                    <AssistantMessage message={message} orders={orderStates} />
                  </section>
                );
              })}
            </div>
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
