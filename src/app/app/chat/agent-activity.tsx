"use client";

import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Download,
  FileText,
  Film,
  Globe,
  ImageIcon,
  Loader2,
  Lock,
  Plug,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ArtifactItem, ToolKind, TraceEvent, TraceTool } from "@/lib/trace-types";

type TraceState = {
  status: string;
  thinking: string;
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  assistant: string;
  toolOrder: string[];
  tools: Record<string, TraceTool>;
  result?: Extract<TraceEvent, { type: "result" }>;
  error?: string;
  expired: boolean;
  done: boolean;
};

const initialState: TraceState = {
  status: "",
  thinking: "",
  assistant: "",
  toolOrder: [],
  tools: {},
  expired: false,
  done: false,
};

function reducer(state: TraceState, action: { event: TraceEvent; at: number }): TraceState {
  const { event, at: now } = action;
  const endThinking = state.thinking && !state.thinkingEndedAt ? { thinkingEndedAt: now } : {};
  switch (event.type) {
    case "status":
      return { ...state, status: event.status };
    case "thinking":
      return {
        ...state,
        thinking: state.thinking + event.text,
        thinkingStartedAt: state.thinkingStartedAt ?? now,
      };
    case "assistant":
      return { ...state, ...endThinking, assistant: state.assistant + event.text };
    case "tool": {
      const known = event.callId in state.tools;
      return {
        ...state,
        ...endThinking,
        tools: { ...state.tools, [event.callId]: { ...state.tools[event.callId], ...event } },
        toolOrder: known ? state.toolOrder : [...state.toolOrder, event.callId],
      };
    }
    case "result":
      return { ...state, ...endThinking, result: event, status: event.status };
    case "error":
      return { ...state, error: event.message };
    case "expired":
      return { ...state, expired: true };
    case "done":
      return { ...state, ...endThinking, done: true };
  }
}

const KIND_ICON: Record<ToolKind, typeof Wrench> = {
  terminal: SquareTerminal,
  file: FileText,
  browser: Globe,
  search: Search,
  mcp: Plug,
  vault: Lock,
  other: Wrench,
};

function formatBytes(bytes?: number) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSeconds(ms?: number) {
  if (!ms || ms < 0) return "";
  return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`;
}

function fileUrl(jobId: string, path: string) {
  return `/api/jobs/${encodeURIComponent(jobId)}/artifacts/file?path=${encodeURIComponent(path)}`;
}

function Json({ value }: { value: unknown }) {
  if (value === undefined) return null;
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StepRow({ tool }: { tool: TraceTool }) {
  const Icon = KIND_ICON[tool.kind];
  const running = tool.status === "running";
  return (
    <details className="group rounded-lg border border-border/60 bg-background/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={
            tool.kind === "terminal" || tool.kind === "file"
              ? "min-w-0 flex-1 truncate font-mono text-xs"
              : "min-w-0 flex-1 truncate"
          }
        >
          {tool.title}
        </span>
        {tool.kind === "vault" && (
          <Badge variant="outline" className="gap-1">
            <Lock /> secret hidden
          </Badge>
        )}
        {running ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Check className="size-4 shrink-0 text-emerald-600" />
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-border/60 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Tool <span className="font-mono">{tool.name}</span>
          {tool.truncated?.args || tool.truncated?.result ? " · output too large, truncated by Cursor" : ""}
        </p>
        {tool.args !== undefined && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Input</p>
            <Json value={tool.args} />
          </div>
        )}
        {tool.result !== undefined && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Output</p>
            <Json value={tool.result} />
          </div>
        )}
      </div>
    </details>
  );
}

function TerminalPanel({ tools, running }: { tools: TraceTool[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [tools]);
  if (!tools.length) {
    return <p className="px-1 py-3 text-sm text-muted-foreground">No terminal commands yet.</p>;
  }
  return (
    <div className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100">
      {tools.map((t) => (
        <div key={t.callId} className="mb-3 last:mb-0">
          <div>
            <span className="text-emerald-400">agent@cloud</span>
            <span className="text-zinc-500">:~$ </span>
            <span>{t.terminal?.command}</span>
          </div>
          {t.terminal?.output && <pre className="whitespace-pre-wrap text-zinc-300">{t.terminal.output}</pre>}
          {t.status === "running" ? (
            <span className="inline-block h-3.5 w-2 animate-pulse bg-zinc-300 align-middle" />
          ) : (
            t.terminal?.exitCode !== undefined && (
              <div className={t.terminal.exitCode === 0 ? "text-zinc-500" : "text-red-400"}>
                exit {t.terminal.exitCode}
              </div>
            )
          )}
        </div>
      ))}
      {running && !tools.some((t) => t.status === "running") && (
        <div>
          <span className="text-emerald-400">agent@cloud</span>
          <span className="text-zinc-500">:~$ </span>
          <span className="inline-block h-3.5 w-2 animate-pulse bg-zinc-300 align-middle" />
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function BrowserPanel({
  jobId,
  tools,
  media,
}: {
  jobId: string;
  tools: TraceTool[];
  media: ArtifactItem[];
}) {
  const [selected, setSelected] = useState(0);
  const current = media[Math.min(selected, media.length - 1)];
  return (
    <div className="space-y-3">
      {current ? (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/30">
          {current.kind === "video" ? (
            <video src={fileUrl(jobId, current.path)} controls className="w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(jobId, current.path)} alt={current.path} className="w-full" />
          )}
          <p className="border-t border-border/70 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
            {current.path}
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
          Screenshots and recordings appear here when the agent saves them to <span className="font-mono">artifacts/</span>.
        </p>
      )}
      {media.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {media.map((m, i) => (
            <button
              key={m.path}
              type="button"
              onClick={() => setSelected(i)}
              className={`relative h-16 w-28 shrink-0 overflow-hidden rounded-md border ${
                i === selected ? "border-primary ring-2 ring-primary/30" : "border-border/70"
              }`}
            >
              {m.kind === "video" ? (
                <Film className="m-auto size-5 text-muted-foreground" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(jobId, m.path)} alt="" className="h-full w-full object-cover object-top" />
              )}
            </button>
          ))}
        </div>
      )}
      {tools.length > 0 && (
        <div className="space-y-1.5">
          {tools.map((t) => (
            <StepRow key={t.callId} tool={t} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        The Cursor API doesn&apos;t stream the agent&apos;s live desktop, so this shows the screenshots and recordings it saves.
      </p>
    </div>
  );
}

function FilesPanel({
  jobId,
  artifacts,
  edited,
}: {
  jobId: string;
  artifacts: ArtifactItem[];
  edited: TraceTool[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Artifacts</p>
        {!artifacts.length ? (
          <p className="text-sm text-muted-foreground">No artifacts yet.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {artifacts.map((a) => {
              const Icon = a.kind === "image" ? ImageIcon : a.kind === "video" ? Film : FileText;
              return (
                <li key={a.path} className="flex items-center gap-3 px-3 py-2 text-sm">
                  {a.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl(jobId, a.path)}
                      alt=""
                      className="h-9 w-14 shrink-0 rounded border border-border/60 object-cover object-top"
                    />
                  ) : (
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{a.path}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                  <a
                    href={fileUrl(jobId, a.path)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${a.path}`}
                  >
                    <Download className="size-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {edited.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Files touched</p>
          <ul className="space-y-1">
            {edited.map((t) => (
              <li key={t.callId} className="flex items-center gap-2 text-xs">
                <Badge variant={t.file?.action === "Read" ? "outline" : "secondary"}>{t.file?.action}</Badge>
                <span className="truncate font-mono">{t.file?.path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AgentActivity({
  jobId,
  active,
  hasReply,
  defaultOpen,
}: {
  jobId: string;
  active: boolean;
  hasReply: boolean;
  defaultOpen: boolean;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [open, setOpen] = useState(defaultOpen || active);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [wantStream, setWantStream] = useState(defaultOpen || active);

  const loadArtifacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/artifacts`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { items?: ArtifactItem[] };
      setArtifacts(body.items ?? []);
    } catch {
      // keep previous list
    }
  }, [jobId]);

  const onResult = useEffectEvent(() => {
    void loadArtifacts();
    router.refresh();
  });

  // One connection per job; collapsing the panel must not restart (and replay) the stream.
  useEffect(() => {
    if (!wantStream) return;
    const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as TraceEvent;
      dispatch({ event, at: Date.now() });
      if (event.type === "result") onResult();
      if (event.type === "done") source.close();
    };
    return () => source.close();
  }, [wantStream, jobId]);

  const running = !state.done && !state.result && !state.error;

  useEffect(() => {
    if (!open) return;
    const first = window.setTimeout(loadArtifacts, 0);
    const poll = running ? window.setInterval(loadArtifacts, 8000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (poll) window.clearInterval(poll);
    };
  }, [open, running, loadArtifacts]);

  const tools = useMemo(() => state.toolOrder.map((id) => state.tools[id]), [state.toolOrder, state.tools]);
  const terminalTools = tools.filter((t) => t.kind === "terminal");
  const browserTools = tools.filter((t) => t.kind === "browser" || t.kind === "vault");
  const fileTools = tools.filter((t) => t.kind === "file" && t.file);
  const media = artifacts.filter((a) => a.kind === "image" || a.kind === "video");
  const thinkingMs =
    state.thinkingEndedAt && state.thinkingStartedAt
      ? state.thinkingEndedAt - state.thinkingStartedAt
      : undefined;
  const isThinking = !!state.thinking && !state.thinkingEndedAt && running;

  const statusLabel = state.error
    ? "Error"
    : state.expired
      ? "Trace expired"
      : state.result
        ? state.result.status === "FINISHED"
          ? `Finished${state.result.durationMs ? ` in ${formatSeconds(state.result.durationMs)}` : ""}`
          : state.result.status
        : state.status === "QUEUED" || !state.status
          ? active
            ? "Starting…"
            : "Agent activity"
          : isThinking
            ? "Thinking…"
            : "Working…";

  return (
    <div className="mr-auto w-full max-w-[92%] space-y-2">
      <div className="rounded-xl border border-border/70 bg-background/70 shadow-xs">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setWantStream(true);
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        >
          {state.error ? (
            <AlertTriangle className="size-4 text-destructive" />
          ) : running && (active || state.status) ? (
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
          ) : (
            <Check className="size-4 text-emerald-600" />
          )}
          <span className="font-medium">{statusLabel}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            {tools.length > 0 && <span>{tools.length} steps</span>}
            {terminalTools.length > 0 && <span>· {terminalTools.length} commands</span>}
            {artifacts.length > 0 && <span>· {artifacts.length} files</span>}
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </button>

        {open && (
          <div className="space-y-3 border-t border-border/60 px-3 py-3">
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            {state.expired && (
              <p className="text-sm text-muted-foreground">
                Cursor only keeps the live trace for a limited time. The reply and artifacts are still available.
              </p>
            )}

            {state.thinking && (
              <details open={isThinking} className="group rounded-lg bg-muted/40 px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground">
                  <Brain className="size-4" />
                  {isThinking ? "Thinking…" : `Thought for ${formatSeconds(thinkingMs) || "a moment"}`}
                  <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-2 max-h-40 overflow-auto text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground italic">
                  {state.thinking}
                </p>
              </details>
            )}

            <Tabs defaultValue="steps">
              <TabsList>
                <TabsTrigger value="steps">Steps {tools.length > 0 && `(${tools.length})`}</TabsTrigger>
                <TabsTrigger value="terminal">Terminal {terminalTools.length > 0 && `(${terminalTools.length})`}</TabsTrigger>
                <TabsTrigger value="browser">Browser {media.length > 0 && `(${media.length})`}</TabsTrigger>
                <TabsTrigger value="files">Files {artifacts.length > 0 && `(${artifacts.length})`}</TabsTrigger>
              </TabsList>
              <TabsContent value="steps" className="space-y-1.5 pt-2">
                {tools.length ? (
                  tools.map((t) => <StepRow key={t.callId} tool={t} />)
                ) : (
                  <p className="px-1 py-3 text-sm text-muted-foreground">
                    {running ? "Waiting for the agent's first step…" : "No tool calls in this run."}
                  </p>
                )}
              </TabsContent>
              <TabsContent value="terminal" className="pt-2">
                <TerminalPanel tools={terminalTools} running={running && !!state.status} />
              </TabsContent>
              <TabsContent value="browser" className="pt-2">
                <BrowserPanel jobId={jobId} tools={browserTools} media={media} />
              </TabsContent>
              <TabsContent value="files" className="pt-2">
                <FilesPanel jobId={jobId} artifacts={artifacts} edited={fileTools} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {!hasReply && (state.assistant || active) && (
        <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-border/70 bg-muted/40 px-3 py-2 text-sm">
          {state.assistant ? (
            <p className="whitespace-pre-wrap">
              {state.assistant}
              {running && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-middle" />}
            </p>
          ) : (
            <p className="text-muted-foreground">Agent working…</p>
          )}
        </div>
      )}
    </div>
  );
}
