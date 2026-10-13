import { Sparkles } from "lucide-react";

import { TopBar } from "@/components/app-frame";
import { AssistantMessage, UserMessage } from "@/components/chat/messages";
import { ScrollAnchor } from "@/components/chat/scroll-anchor";
import { Composer } from "@/components/composer";
import { isValidThreadId } from "@/lib/agent-api";
import { formatBytes, MAX_FILE_BYTES } from "@/lib/file-limits";
import { chatMessage, listChatThreads, listThreadJobs, newThreadId } from "@/lib/threads";
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
  const { user, workspace } = await requireAgentUser();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const requested = typeof params.t === "string" && isValidThreadId(params.t) ? params.t : undefined;

  const threads = await listChatThreads(user.id);
  const threadId = params.new ? newThreadId() : (requested ?? threads[0]?.id ?? newThreadId());
  const thread = threads.find((t) => t.id === threadId);
  const jobs = thread ? await listThreadJobs(user.id, threadId) : [];
  const messages = jobs.map((job) => ({ job, message: chatMessage(job) }));
  const working = messages.some((m) => m.message.status === "working");

  const composer = (empty: boolean) => (
    <Composer
      action="/app/chat/send"
      uploadUrl="/app/files"
      fields={{ threadId }}
      autoFocus={empty}
      placeholder={empty ? "Ask anything, or drop a PDF, CSV or Excel file…" : "Reply…"}
      suggestions={
        empty
          ? [
              ...(workspace?.skills ?? []).slice(0, 3).map((s) => `Help me with ${s.name.toLowerCase()}`),
              "What can you do for me?",
            ]
          : undefined
      }
      hint={
        empty
          ? `PDF, CSV and Excel up to ${formatBytes(MAX_FILE_BYTES)}. Private to you${workspace ? ` · ${workspace.name} can review your chats` : ""}.`
          : undefined
      }
    />
  );

  const errorBanner = error && (
    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
  );

  if (!messages.length) {
    return (
      <div className="flex min-h-full shrink-0 flex-col">
        <TopBar title="New chat" />
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 pb-[12vh]">
          <div className="text-center">
            <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl border bg-card">
              <Sparkles className="size-5 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">What can I help you with?</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your personal agent{workspace ? ` from ${workspace.name}` : ""}. It remembers past chats and can use the
              accounts you connect.
            </p>
          </div>
          {errorBanner}
          {composer(true)}
        </div>
      </div>
    );
  }

  const last = messages[messages.length - 1].message;
  return (
    <div className="flex min-h-full shrink-0 flex-col">
      <ChatRefresh active={working} />
      <TopBar title={thread?.title ?? "Chat"} />
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 pt-8 pb-10">
        {messages.map(({ job, message }) => (
          <section key={message.id} className="space-y-5">
            <UserMessage text={message.text} attachments={message.attachments} />
            <AssistantMessage
              message={message}
              live={<AgentProgress jobId={job.id} startedAt={job.createdAt} steps={message.steps} />}
            >
              {job.cursorAgentId ? <FileBrowser jobId={job.id} active={message.status === "working"} /> : null}
            </AssistantMessage>
          </section>
        ))}
        {errorBanner}
        <ScrollAnchor version={`${messages.length}:${last.status}:${last.blocks.length}:${last.steps.length}`} />
      </div>
      <div className="sticky bottom-0 z-10 bg-linear-to-t from-background from-70% to-transparent px-4 pt-6 pb-4">
        <div className="mx-auto max-w-3xl">{composer(false)}</div>
      </div>
    </div>
  );
}
