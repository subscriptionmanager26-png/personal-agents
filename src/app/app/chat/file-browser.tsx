"use client";

import { ChevronDown, ChevronRight, Download, FileText, Film, Folder, FolderOpen, ImageIcon, File as FileIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ArtifactItem } from "@/lib/trace-types";

const ROOT = "artifacts/";

function formatBytes(bytes?: number) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileUrl(jobId: string, path: string, asText = false) {
  const base = `/api/jobs/${encodeURIComponent(jobId)}/artifacts/file?path=${encodeURIComponent(path)}`;
  return asText ? `${base}&as=text` : base;
}

function displayPath(path: string) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length) : path;
}

function KindIcon({ kind, className }: { kind: ArtifactItem["kind"]; className?: string }) {
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Film : kind === "text" ? FileText : FileIcon;
  return <Icon className={className} />;
}

type Group = { folder: string; items: ArtifactItem[] };

function groupByFolder(items: ArtifactItem[]): Group[] {
  const groups = new Map<string, ArtifactItem[]>();
  for (const item of items) {
    const rel = displayPath(item.path);
    const slash = rel.lastIndexOf("/");
    const folder = slash === -1 ? "" : rel.slice(0, slash);
    groups.set(folder, [...(groups.get(folder) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([folder, list]) => ({
      folder,
      items: list.sort((x, y) => x.path.localeCompare(y.path)),
    }));
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
  return (
    <pre className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

function Preview({ jobId, item }: { jobId: string; item: ArtifactItem }) {
  const url = fileUrl(jobId, item.path);
  switch (item.kind) {
    case "image":
      return (
        <div className="flex h-full items-start justify-center overflow-auto bg-muted/30 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={displayPath(item.path)} className="max-w-full rounded border border-border/60 bg-white shadow-xs" />
        </div>
      );
    case "video":
      return (
        <div className="flex h-full items-center justify-center bg-black">
          <video src={url} controls className="max-h-full max-w-full" />
        </div>
      );
    case "text":
      return <TextPreview key={item.path} jobId={jobId} path={item.path} />;
    default:
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <FileIcon className="size-8" />
          No preview for this file type.
        </div>
      );
  }
}

export function FileBrowser({ jobId, active }: { jobId: string; active: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<ArtifactItem[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/artifacts`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { items?: ArtifactItem[] };
      setItems(body.items ?? []);
    } catch {
      // keep the previous listing
    }
  }, [jobId]);

  // Older messages only hit the Cursor artifacts API once they scroll into view.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const first = window.setTimeout(load, 0);
    const poll = active ? window.setInterval(load, 8000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (poll) window.clearInterval(poll);
    };
  }, [visible, active, load]);

  const groups = useMemo(() => groupByFolder(items ?? []), [items]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selected = ordered.find((i) => i.path === selectedPath) ?? ordered[0];

  if (!items?.length) return <div ref={rootRef} />;

  if (!open) {
    return (
      <div ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Folder className="size-3.5" />
          {items.length} {items.length === 1 ? "file" : "files"} created
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="w-full overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted/40"
      >
        <FolderOpen className="size-4 text-muted-foreground" />
        <span className="font-medium">Files</span>
        <span className="text-xs text-muted-foreground">{items.length}</span>
        <ChevronDown className="ml-auto size-4 text-muted-foreground" />
      </button>
      <div className="grid sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <ul className="max-h-[420px] overflow-auto border-b border-border/60 py-1 sm:border-r sm:border-b-0">
          {groups.map((group) => (
            <li key={group.folder || "/"}>
              {group.folder && (
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs text-muted-foreground">
                  <Folder className="size-3.5" />
                  {group.folder}
                </div>
              )}
              <ul>
                {group.items.map((item) => {
                  const isSelected = item.path === selected?.path;
                  const name = displayPath(item.path).split("/").pop();
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        onClick={() => setSelectedPath(item.path)}
                        className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm ${
                          group.folder ? "pl-7" : "pl-3"
                        } ${isSelected ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                      >
                        <KindIcon kind={item.kind} className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(item.sizeBytes)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {selected && (
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {displayPath(selected.path)}
              </span>
              <a
                href={fileUrl(jobId, selected.path)}
                download={displayPath(selected.path).split("/").pop()}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Download className="size-3.5" />
                Download
              </a>
            </div>
            <div className="h-[380px]">
              <Preview jobId={jobId} item={selected} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
