"use client";

import { FileSpreadsheet, FileText, Loader2, Lock, Paperclip, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPTED_EXTENSIONS, ACCEPTED_FILE_TYPES, formatBytes, MAX_ATTACHMENTS, MAX_FILE_BYTES } from "@/lib/file-limits";

type Item = {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "needs_password" | "unlocking" | "error";
  id?: string;
  error?: string;
  password?: string;
};

function withParam(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

async function errorMessage(res: Response) {
  const body = await res.json().catch(() => undefined);
  return body?.error?.message || `Upload failed (${res.status})`;
}

/**
 * Message box with PDF / CSV / Excel attachments. Posts a native form to `action`
 * (fields `text` and repeated `attachments`), or calls `onSend`.
 */
export function Composer({
  uploadUrl,
  action,
  onSend,
  disabled,
  placeholder = "Message your agent…",
  hint,
}: {
  uploadUrl: string;
  action?: string;
  onSend?: (text: string, attachmentIds: string[]) => Promise<boolean>;
  disabled?: boolean;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const patch = (key: string, next: Partial<Item>) =>
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...next } : i)));

  const upload = async (file: File, key: string) => {
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch(uploadUrl, { method: "POST", body });
      if (!res.ok) return patch(key, { status: "error", error: await errorMessage(res) });
      const { file: uploaded } = (await res.json()) as { file: { id: string; status: string } };
      patch(key, { id: uploaded.id, status: uploaded.status === "needs_password" ? "needs_password" : "ready" });
    } catch {
      patch(key, { status: "error", error: "Upload failed. Check your connection." });
    }
  };

  const addFiles = (list: FileList | File[]) => {
    const files = Array.from(list);
    const room = MAX_ATTACHMENTS - items.length;
    const added: Item[] = files.slice(0, Math.max(0, room)).map((f) => {
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      const key = `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`;
      const error = !ACCEPTED_EXTENSIONS.includes(ext)
        ? "Only PDF, CSV and Excel files"
        : f.size > MAX_FILE_BYTES
          ? `Larger than ${formatBytes(MAX_FILE_BYTES)}`
          : undefined;
      return { key, name: f.name, size: f.size, status: error ? "error" : "uploading", error };
    });
    if (files.length > room) {
      added.push({ key: `limit-${Date.now()}`, name: `${files.length - room} more`, size: 0, status: "error", error: `At most ${MAX_ATTACHMENTS} files per message` });
    }
    setItems((cur) => [...cur, ...added]);
    added.forEach((item, i) => {
      if (item.status === "uploading") void upload(files[i], item.key);
    });
  };

  const unlock = async (item: Item) => {
    if (!item.id || !item.password) return;
    patch(item.key, { status: "unlocking", error: undefined });
    const res = await fetch(withParam(uploadUrl, "unlock", item.id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: item.password }),
    });
    if (res.ok) patch(item.key, { status: "ready", password: undefined });
    else patch(item.key, { status: "needs_password", error: await errorMessage(res), password: "" });
  };

  const ready = items.filter((i) => i.status === "ready" && i.id);
  const busy = items.some((i) => i.status === "uploading" || i.status === "unlocking" || i.status === "needs_password");
  const canSend = !disabled && !sending && !busy && (text.trim().length > 0 || ready.length > 0);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (!canSend) {
      e.preventDefault();
      return;
    }
    if (!onSend) return;
    e.preventDefault();
    setSending(true);
    try {
      if (await onSend(text, ready.map((i) => i.id!))) {
        setText("");
        setItems([]);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      action={action}
      method={action ? "post" : undefined}
      onSubmit={submit}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
      className={`space-y-2 rounded-xl border p-2 transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border/70"}`}
    >
      {ready.map((i) => (
        <input key={i.key} type="hidden" name="attachments" value={i.id} />
      ))}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const Icon = item.name.toLowerCase().endsWith(".pdf") ? FileText : FileSpreadsheet;
            return (
              <div
                key={item.key}
                className={`flex max-w-full items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                  item.status === "error" ? "border-destructive/50 text-destructive" : "border-border/70 bg-muted/40"
                }`}
              >
                {item.status === "uploading" || item.status === "unlocking" ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                ) : item.status === "needs_password" ? (
                  <Lock className="size-3.5 shrink-0" />
                ) : (
                  <Icon className="size-3.5 shrink-0" />
                )}
                <span className="max-w-48 truncate font-medium">{item.name}</span>
                {item.size > 0 && <span className="text-muted-foreground">{formatBytes(item.size)}</span>}
                {item.status === "error" && <span>{item.error}</span>}
                {item.status === "needs_password" && (
                  <>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="PDF password"
                      value={item.password ?? ""}
                      onChange={(e) => patch(item.key, { password: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void unlock(item);
                        }
                      }}
                      className="h-6 w-32 text-xs"
                    />
                    <Button type="button" size="xs" variant="outline" onClick={() => void unlock(item)}>
                      Unlock
                    </Button>
                    {item.error && <span className="text-destructive">{item.error}</span>}
                  </>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => setItems((cur) => cur.filter((i) => i.key !== item.key))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <Textarea
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="resize-none border-0 shadow-none focus-visible:ring-0"
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPTED_FILE_TYPES}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => picker.current?.click()}
            disabled={items.length >= MAX_ATTACHMENTS}
            title="Attach PDF, CSV or Excel"
          >
            <Paperclip className="size-4" />
            Attach
          </Button>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
        <Button type="submit" disabled={!canSend}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : null}
          Send
        </Button>
      </div>
    </form>
  );
}

export function AttachmentChips({ attachments }: { attachments: { id: string; name: string; size: number }[] }) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {attachments.map((a) => {
        const Icon = a.name.toLowerCase().endsWith(".pdf") ? FileText : FileSpreadsheet;
        return (
          <span key={a.id} className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs">
            <Icon className="size-3.5" />
            <span className="max-w-48 truncate">{a.name}</span>
            <span className="text-muted-foreground">{formatBytes(a.size)}</span>
          </span>
        );
      })}
    </div>
  );
}
