import Link from "next/link";

import { MemoryList } from "@/components/memory-list";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listMemories } from "@/lib/memory";
import { requireAgentUser } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, isOwner, workspace } = await requireAgentUser();
  const memories = await listMemories(user.id);
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/settings" className="text-sm text-muted-foreground hover:text-foreground">
          ← Settings
        </Link>
        <h1 className="mt-2 font-heading text-3xl tracking-tight">Agent memory</h1>
        <p className="mt-1 text-muted-foreground">
          Your agent keeps these notes itself: after each chat it saves what matters and decides
          how important each note is. The most important notes are loaded into every conversation.
          Only your agent can see them
          {!isOwner && workspace ? `, and ${workspace.name} can read them` : ""}.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>What your agent remembers</CardTitle>
          <CardDescription>{memories.length} notes, most important first</CardDescription>
        </CardHeader>
        <CardContent>
          <MemoryList memories={memories} deletable />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tell your agent something to remember</CardTitle>
          <CardDescription>Optional. Never put passwords here; use Connections for logins.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/app/settings/memory/create" method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required placeholder="Risk appetite" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="importance">Importance</Label>
                <select
                  id="importance"
                  name="importance"
                  defaultValue="4"
                  className="h-8 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="5">5 · critical</option>
                  <option value="4">4 · high</option>
                  <option value="3">3 · normal</option>
                  <option value="2">2 · low</option>
                  <option value="1">1 · trivia</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="content">Content</Label>
              <Textarea
                id="content"
                name="content"
                required
                rows={3}
                placeholder="Moderate risk; avoid single stocks over 10% of the portfolio."
              />
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
