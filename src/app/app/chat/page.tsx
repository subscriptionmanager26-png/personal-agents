import { AttachmentChips, Composer } from "@/components/composer";
import { listJobsForUser } from "@/lib/jobs";
import { requireAgentUser } from "@/lib/viewer";

import { AgentProgress } from "./agent-progress";
import { FileBrowser } from "./file-browser";
import { ChatRefresh } from "./refresh-client";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, workspace, isOwner } = await requireAgentUser();
  const jobs = (await listJobsForUser(user.id, 40)).filter(
    (j) => j.source === "web" || !j.source,
  );
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const pending = jobs.some(
    (j) =>
      j.status === "queued" ||
      j.status === "dispatched" ||
      j.status === "delivering",
  );

  // Oldest first for chat reading
  const timeline = [...jobs].reverse();

  return (
    <div className="flex min-h-[70vh] flex-col gap-6">
      <ChatRefresh active={pending} />
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Chat</h1>
        <p className="mt-1 text-muted-foreground">
          {isOwner
            ? "Your own agent, with the same skills your clients get. Use it to test your skills."
            : `Your personal agent from ${workspace?.name}. It remembers past chats and can use the accounts you connect.`}
        </p>
        {!isOwner && workspace && (
          <p className="mt-2 text-xs text-muted-foreground">
            Private to you. No other client&apos;s agent can see this. {workspace.name} can read
            your chats and memory.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex-1 space-y-4 rounded-xl border border-border/70 bg-background/50 p-4">
        {!timeline.length ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Say hello, or ask your agent what it can help with.
          </p>
        ) : (
          timeline.map((job) => {
            const active =
              job.status === "queued" ||
              job.status === "dispatched" ||
              job.status === "delivering";
            return (
              <div key={job.id} className="space-y-2">
                <AttachmentChips attachments={job.attachments ?? []} />
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                  <p className="whitespace-pre-wrap">{job.prompt}</p>
                </div>
                {active && !job.reply?.message && !job.error ? (
                  <AgentProgress jobId={job.id} startedAt={job.createdAt} />
                ) : null}
                {job.reply?.message ? (
                  <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-border/70 bg-muted/40 px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{job.reply.message}</p>
                  </div>
                ) : job.error ? (
                  <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {job.error}
                  </div>
                ) : null}
                {job.cursorAgentId ? <FileBrowser jobId={job.id} active={active} /> : null}
              </div>
            );
          })
        )}
      </div>

      <Composer
        action="/app/chat/send"
        uploadUrl="/app/files"
        placeholder="Message your personal agent, or attach a PDF, CSV or Excel file…"
        hint={
          pending
            ? "Agent is working — this page refreshes automatically."
            : "PDF, CSV and Excel up to 4 MB. Drop files here."
        }
      />
    </div>
  );
}
