"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function Shown({ value, note }: { value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/50 p-3">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function CreateApiKey() {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            setKey((await post("/app/developers/keys", { label })).key);
            setLabel("");
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production backend" />
        <Button type="submit">Create key</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {key && (
        <Shown value={key} note="Shown once. Store it in your backend's secrets; never ship it to a browser or app." />
      )}
    </div>
  );
}

export function SigningSecret({ exists }: { exists: boolean }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const run = async (action: "reveal" | "rotate") => {
    if (action === "rotate" && !confirm("Rotate the secret? Your MCP servers must switch to the new one.")) return;
    setError("");
    try {
      setSecret((await post("/app/developers/secret", { action })).secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => run("reveal")}>
          {exists ? "Reveal secret" : "Create secret"}
        </Button>
        {exists && (
          <Button type="button" variant="ghost" onClick={() => run("rotate")}>
            Rotate
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {secret && <Shown value={secret} note="HS256 key. Configure it in your MCP servers to verify user tokens." />}
    </div>
  );
}
