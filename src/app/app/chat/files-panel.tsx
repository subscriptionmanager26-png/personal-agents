"use client";

import {
  ArrowLeft,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  ImageIcon,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/file-limits";
import type { ArtifactItem } from "@/lib/trace-types";
import type { JobAttachment } from "@/lib/types";

const ROOT = "artifacts/";

export type FilesJob = { id: string; title: string; active: boolean };
type Selected = { jobId: string; path: string };

type FilesState = {
  jobs: FilesJob[];
  uploads: JobAttachment[];
  items: Record<string, ArtifactItem[]>;
  total: number;
  open: boolean;
  selected?: Selected;
  setOpen: (open: boolean) => void;
  select: (selected?: Selected) => void;
};

const FilesContext = createContext<FilesState | null>(null);

function useFiles() {
  const ctx = useContext(FilesContext);
  if (!ctx) throw new Error("FilesProvider missing");
  return ctx;
}

function fileUrl(jobId: string, path: string, asText = false) {
  const base = `/api/jobs/${encodeURIComponent(jobId)}/artifacts/file?path=${encodeURIComponent(path)}`;
  return asText ? `${base}&as=text` : base;
}

function displayPath(path: string) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length) : path;
}

const baseName = (path: string) => displayPath(path).split("/").pop() || path;

function KindIcon({ kind, className }: { kind: ArtifactItem["kind"]; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Film : kind === "text" ? FileText : FileIcon;
  return <Icon className={className} />;
}

/** Agent-created files for every message in a thread, shared by the chips in chat and the side panel. */
export function FilesProvider({ jobs, uploads, children }: { jobs: FilesJob[]; uploads: JobAttachment[]; children: ReactNode }) {
  const [items, setItems] = useState<Record<string, ArtifactItem[]>>({});
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Selected>();

  const load = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/artifacts`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { items?: ArtifactItem[] };
      setItems((cur) => ({ ...cur, [jobId]: body.items ?? [] }));
    } catch {
      // keep the previous listing
    }
  }, []);

  const key = jobs.map((j) => `${j.id}:${j.active ? 1 : 0}`).join(",");
  useEffect(() => {
    const first = window.setTimeout(() => jobs.forEach((j) => void load(j.id)), 0);
    const active = jobs.filter((j) => j.active);
    const poll = active.length ? window.setInterval(() => active.forEach((j) => void load(j.id)), 8000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (poll) window.clearInterval(poll);
    };
    // `key` captures every job id and whether it is still running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);

  const total = useMemo(
    () => Object.values(items).reduce((n, list) => n + list.length, 0) + uploads.length,
    [items, uploads.length],
  );

  const value: FilesState = {
    jobs,
    uploads,
    items,
    total,
    open,
    selected,
    setOpen,
    select: (next) => {
      setSelected(next);
      if (next) setOpen(true);
    },
  };
  return <FilesContext.Provider value={value}>{children}</FilesContext.Provider>;
}

export function FilesToggle() {
  const { total, open, setOpen } = useFiles();
  if (!total) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={`gap-1.5 text-muted-foreground ${open ? "bg-muted text-foreground" : ""}`}
            onClick={() => setOpen(!open)}
            aria-label="Toggle files"
          />
        }
      >
        <FolderOpen />
        <span className="tabular-nums">{total}</span>
      </TooltipTrigger>
      <TooltipContent>Files in this chat</TooltipContent>
    </Tooltip>
  );
}

/** Compact references under a reply; the files themselves open in the side panel. */
export function MessageFiles({ jobId }: { jobId: string }) {
  const { items, select, setOpen } = useFiles();
  const list = items[jobId] ?? [];
  if (!list.length) return null;
  const shown = list.slice(0, 4);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((item) => (
        <button
          key={item.path}
          type="button"
          onClick={() => select({ jobId, path: item.path })}
          className="flex max-w-60 items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <KindIcon kind={item.kind} className="size-3.5 shrink-0" />
          <span className="truncate">{baseName(item.path)}</span>
        </button>
      ))}
      {list.length > shown.length && (
        <button
          type="button"
          onClick={() => {
            select(undefined);
            setOpen(true);
          }}
          className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          +{list.length - shown.length} more
        </button>
      )}
    </div>
  );
}

function TextPreview({ jobId, path }: { jobId: string; path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(fileUrl(jobId, path, true), { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then(setText)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [jobId, path]);

  if (failed) return <p className="p-4 text-sm text-muted-foreground">Couldn&apos;t load a preview of this file.</p>;
  if (text === null) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (path.toLowerCase().endsWith(".md")) {
    return (
      <div className="px-5 py-4">
        <Markdown text={text} />
      </div>
    );
  }
  return <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{text}</pre>;
}

function Preview({ jobId, item }: { jobId: string; item: ArtifactItem }) {
  const url = fileUrl(jobId, item.path);
  switch (item.kind) {
    case "image":
      return (
        <div className="flex justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={baseName(item.path)} className="max-w-full rounded-lg border bg-white" />
        </div>
      );
    case "video":
      return (
        <div className="flex justify-center bg-black p-2">
          <video src={url} controls className="max-h-[70vh] max-w-full" />
        </div>
      );
    case "text":
      return <TextPreview key={item.path} jobId={jobId} path={item.path} />;
    default:
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <FileIcon className="size-8" />
          No preview for this file type.
        </div>
      );
  }
}

function FileRow({ icon, name, meta, onClick, href }: { icon: ReactNode; name: string; meta?: string; onClick?: () => void; href?: string }) {
  const className =
    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted";
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {meta && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{meta}</span>}
    </>
  );
  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

export function FilesPanel() {
  const { jobs, uploads, items, total, open, selected, setOpen, select } = useFiles();
  if (!open) return null;

  const current = selected ? items[selected.jobId]?.find((i) => i.path === selected.path) : undefined;
  const groups = jobs.filter((j) => items[j.id]?.length);

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l bg-sidebar shadow-2xl sm:w-[480px] lg:sticky lg:top-12 lg:z-0 lg:h-[calc(100svh-3rem)] lg:w-[min(520px,42vw)] lg:shrink-0 lg:shadow-none">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 lg:h-10">
        {current ? (
          <>
            <Button variant="ghost" size="icon-xs" aria-label="All files" onClick={() => select(undefined)}>
              <ArrowLeft />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{baseName(current.path)}</span>
            <a
              href={fileUrl(selected!.jobId, current.path)}
              download={baseName(current.path)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Download className="size-3.5" />
              Download
            </a>
          </>
        ) : (
          <>
            <FolderOpen className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Files</span>
            <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
          </>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Close files" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {current ? (
          <Preview jobId={selected!.jobId} item={current} />
        ) : (
          <div className="space-y-4 p-2">
            {!total && <p className="p-3 text-sm text-muted-foreground">Files the agent creates in this chat show up here.</p>}
            {groups.map((job) => (
              <section key={job.id}>
                <p className="truncate px-2 pt-1 pb-1.5 text-xs text-muted-foreground">{job.title}</p>
                {items[job.id].map((item) => (
                  <FileRow
                    key={item.path}
                    icon={<KindIcon kind={item.kind} className="size-4 shrink-0 text-muted-foreground" />}
                    name={baseName(item.path)}
                    meta={item.sizeBytes !== undefined ? formatBytes(item.sizeBytes) : undefined}
                    onClick={() => select({ jobId: job.id, path: item.path })}
                  />
                ))}
              </section>
            ))}
            {uploads.length > 0 && (
              <section>
                <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">Uploaded by you</p>
                {uploads.map((u) => {
                  const Icon = u.kind === "pdf" ? FileText : FileSpreadsheet;
                  return (
                    <FileRow
                      key={u.id}
                      icon={<Icon className={`size-4 shrink-0 ${u.kind === "pdf" ? "text-destructive" : "text-success"}`} />}
                      name={u.name}
                      meta={formatBytes(u.size)}
                      href={`/app/files?download=${encodeURIComponent(u.id)}`}
                    />
                  );
                })}
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
