import { CheckCircle2, CircleDashed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runtimeFor } from "@/lib/runtime";
import type { Workspace } from "@/lib/types";

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs ${ok ? "text-success" : "text-muted-foreground"}`}>
      {ok ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
      {children}
    </p>
  );
}

function ClearButton({ what }: { what: "cursor" | "github" }) {
  return (
    <form action="/app/developers/runtime" method="post">
      <input type="hidden" name="clear" value={what} />
      <Button type="submit" variant="ghost" size="xs" className="text-muted-foreground">
        Remove
      </Button>
    </form>
  );
}

/** Where an owner connects real Cursor agents: their Cursor key, an optional GitHub token for client repos, and a public URL. */
export function RuntimeCard({ workspace, saved, port }: { workspace: Workspace; saved: boolean; port: string }) {
  const r = workspace.runtime ?? {};
  const rt = runtimeFor(workspace);
  const live = Boolean(rt.cursorApiKey);

  return (
    <Card id="runtime" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Agent runtime
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              live ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {live ? "Real Cursor agents" : "Simulated"}
          </span>
        </CardTitle>
        <CardDescription>
          Each of your users gets their own Cursor cloud agent. Keys are encrypted and only used for this
          workspace&apos;s agents. Without a Cursor key, replies are simulated locally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {saved && <p className="text-sm text-success">Saved. New messages use these settings.</p>}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Cursor API key</Label>
            {r.cursorApiKeyEnc && <ClearButton what="cursor" />}
          </div>
          <Status ok={Boolean(rt.cursorApiKey)}>
            {r.cursorKeyLabel ?? (rt.cursorSource === "env" ? "Using the server's CURSOR_API_KEY" : "Not set")}
          </Status>
          <p className="text-xs text-muted-foreground">
            Create one in{" "}
            <a href="https://cursor.com/dashboard/integrations" target="_blank" rel="noreferrer" className="text-info underline-offset-4 hover:underline">
              Cursor → Dashboard → Integrations
            </a>
            . This is all you need for real agents.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>GitHub token (optional)</Label>
            {r.githubTokenEnc && <ClearButton what="github" />}
          </div>
          <Status ok={Boolean(rt.githubToken)}>
            {r.githubTokenLabel ??
              (rt.githubToken ? "Using the server's GITHUB_TOKEN" : "Not set: agents run without a repo")}
          </Status>
          <p className="text-xs text-muted-foreground">
            Gives each user a private repo (<code>agent-…</code>) with your skills as files, and lets agents fill saved
            logins in their browser. Cursor&apos;s GitHub app needs access to those repos. A classic token with the{" "}
            <code>repo</code> scope, or a fine-grained token with Administration and Contents read/write.
          </p>
        </div>

        <form action="/app/developers/runtime" method="post" className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rt-cursor">Cursor API key</Label>
              <Input
                id="rt-cursor"
                name="cursorApiKey"
                type="password"
                autoComplete="off"
                placeholder={r.cursorApiKeyEnc ? "Leave blank to keep" : "key_…"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-github">GitHub token (optional)</Label>
              <Input
                id="rt-github"
                name="githubToken"
                type="password"
                autoComplete="off"
                placeholder={r.githubTokenEnc ? "Leave blank to keep" : "ghp_… or github_pat_…"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-org">GitHub organization (optional)</Label>
              <Input id="rt-org" name="githubOrg" defaultValue={r.githubOrg ?? ""} placeholder="Blank = the token's account" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-url">Public URL of this app</Label>
              <Input id="rt-url" name="agentPublicUrl" defaultValue={r.agentPublicUrl ?? ""} placeholder="https://…" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Agents run in Cursor&apos;s cloud, so they reach this app (UI blocks, memory, files, your MCP servers) through
            the public URL. {rt.agentPublicUrl ? (
              <>Currently <code>{rt.agentPublicUrl}</code>.</>
            ) : (
              <>
                None yet: agents can still reply in text, but without those tools. Locally, run{" "}
                <code>cloudflared tunnel --url http://localhost:{port}</code> and paste the https URL it prints.
              </>
            )}
          </p>
          <Button type="submit">Save and verify</Button>
        </form>
      </CardContent>
    </Card>
  );
}
