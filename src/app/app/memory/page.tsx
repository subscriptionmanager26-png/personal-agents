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
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const session = await getSession();
  if (!session) return null;
  const memories = await listMemories(session.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Memory</h1>
        <p className="mt-1 text-muted-foreground">
          Durable notes injected into your personal agent prompts. Never shared
          across users.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add memory</CardTitle>
          <CardDescription>Preferences, facts, research summaries</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/app/memory/create" method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kind">Kind</Label>
                <select
                  id="kind"
                  name="kind"
                  defaultValue="note"
                  className="h-8 w-full rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="preference">preference</option>
                  <option value="fact">fact</option>
                  <option value="note">note</option>
                  <option value="research_summary">research_summary</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="content">Content</Label>
              <Textarea id="content" name="content" required rows={4} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="pinned" />
              Pin (always included in pack)
            </label>
            <Button type="submit">Save memory</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved</CardTitle>
        </CardHeader>
        <CardContent>
          {!memories.length ? (
            <p className="text-sm text-muted-foreground">No memories yet.</p>
          ) : (
            <ul className="space-y-3">
              {memories.map((m) => (
                <li
                  key={m.id}
                  className="rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {m.title}{" "}
                        <span className="text-xs text-muted-foreground">
                          [{m.kind}
                          {m.pinned ? ", pinned" : ""}]
                        </span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {m.content}
                      </p>
                    </div>
                    <form action="/app/memory/delete" method="post">
                      <input type="hidden" name="id" value={m.id} />
                      <Button variant="ghost" size="sm" type="submit">
                        Delete
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
