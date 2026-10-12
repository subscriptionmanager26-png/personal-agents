import { Sparkles } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listJobsForUser } from "@/lib/jobs";
import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";

import { AgentProgress } from "./agent-progress";
import { FileBrowser } from "./file-browser";
import { ChatRefresh } from "./refresh-client";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) return null;
  const user = await getUser(session.id);
  const jobs = (await listJobsForUser(session.id, 40)).filter(
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
          Talk to your personal Cursor agent. Replies show up in this thread.
        </p>
        {user?.agentRepository && (
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Agent repo: {user.agentRepository}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex-1 space-y-4 rounded-xl border border-border/70 bg-background/50 p-4">
        {!timeline.length ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Ask your agent to research something, summarize a
            note from memory, or install a skill first.
          </p>
        ) : (
          timeline.map((job) => {
            const active =
              job.status === "queued" ||
              job.status === "dispatched" ||
              job.status === "delivering";
            return (
              <div key={job.id} className="space-y-2">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
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
                {job.suggestedMemoryIds?.length ? (
                  <Link
                    href="/app/memory#suggested"
                    className="mr-auto flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Sparkles className="size-3.5" />
                    Suggested {job.suggestedMemoryIds.length} new{" "}
                    {job.suggestedMemoryIds.length === 1 ? "memory" : "memories"} · Review
                  </Link>
                ) : null}
                {job.cursorAgentId ? <FileBrowser jobId={job.id} active={active} /> : null}
              </div>
            );
          })
        )}
      </div>

      <form action="/app/chat/send" method="post" className="space-y-3">
        <Textarea
          name="text"
          required
          rows={3}
          placeholder="Message your personal agent…"
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {pending
              ? "Agent is working — this page refreshes automatically."
              : "Uses your memory, vault tokens, and installed skills."}
          </p>
          <Button type="submit">Send</Button>
        </div>
      </form>
    </div>
  );
}
