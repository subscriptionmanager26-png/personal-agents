"use client";

import { ArrowUp, FileSpreadsheet, FileText, Loader2, Lock, Paperclip, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  fields,
  suggestions,
  autoFocus,
}: {
  uploadUrl: string;
  action?: string;
  onSend?: (text: string, attachmentIds: string[]) => Promise<boolean>;
  disabled?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  /** Extra hidden form fields posted with the message. */
  fields?: Record<string, string>;
  /** Prompts shown above an empty composer; clicking one fills it in. */
  suggestions?: string[];
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

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
    if (!onSend) {
      setSending(true);
      return;
    }
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
    <div className="space-y-2">
      {suggestions && suggestions.length > 0 && !text && !items.length && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setText(s);
                input.current?.focus();
              }}
              className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
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
      className={`rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-ring/60 ${
        dragging ? "border-info bg-info/5" : ""
      }`}
    >
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {ready.map((i) => (
        <input key={i.key} type="hidden" name="attachments" value={i.id} />
      ))}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {items.map((item) => {
            const pdf = item.name.toLowerCase().endsWith(".pdf");
            const Icon = pdf ? FileText : FileSpreadsheet;
            return (
              <div
                key={item.key}
                className={`flex max-w-full items-center gap-2 rounded-lg border py-1 pr-2 pl-1 text-xs ${
                  item.status === "error" ? "border-destructive/50 text-destructive" : "bg-background/60"
                }`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
                    item.status === "error"
                      ? "bg-destructive/15"
                      : pdf
                        ? "bg-destructive/15 text-destructive"
                        : "bg-success/15 text-success"
                  }`}
                >
                  {item.status === "uploading" || item.status === "unlocking" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : item.status === "needs_password" ? (
                    <Lock className="size-3.5" />
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                </span>
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
        ref={input}
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="max-h-60 min-h-14 resize-none border-0 bg-transparent px-4 pt-3.5 text-[15px] shadow-none focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
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
      <div className="flex items-center justify-between gap-3 px-2 pb-2">
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full text-muted-foreground"
                aria-label="Attach files"
                onClick={() => picker.current?.click()}
                disabled={items.length >= MAX_ATTACHMENTS}
              />
            }
          >
            <Paperclip />
          </TooltipTrigger>
          <TooltipContent>Attach PDF, CSV or Excel (up to {formatBytes(MAX_FILE_BYTES)})</TooltipContent>
        </Tooltip>
        <Button type="submit" size="icon-sm" className="rounded-full" disabled={!canSend} aria-label="Send">
          {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </form>
      {hint && <div className="px-1 text-center text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
