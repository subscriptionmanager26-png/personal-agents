import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MemoryEntry } from "@/lib/types";

const SOURCE_LABEL: Record<NonNullable<MemoryEntry["source"]>, string> = {
  agent: "saved by agent",
  user: "added by hand",
  auto: "chat log",
};

export function MemoryList({ memories, deletable }: { memories: MemoryEntry[]; deletable: boolean }) {
  if (!memories.length) return <p className="text-sm text-muted-foreground">No memories yet.</p>;
  return (
    <ul className="space-y-3">
      {memories.map((m) => (
        <li key={m.id} className="rounded-md border border-border/70 px-3 py-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{m.title}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant="secondary">{m.kind}</Badge>
                <Badge variant="outline">importance {m.importance}</Badge>
                {m.pinned && <Badge variant="outline">pinned</Badge>}
                <span className="text-xs text-muted-foreground">
                  {SOURCE_LABEL[m.source ?? "user"]} · {new Date(m.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{m.content}</p>
            </div>
            {deletable && (
              <form action="/app/memory/delete" method="post">
                <input type="hidden" name="id" value={m.id} />
                <Button variant="ghost" size="sm" type="submit">
                  Delete
                </Button>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
