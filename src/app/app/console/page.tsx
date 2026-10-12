import { getStore } from "@/lib/store";
import { requireOwner } from "@/lib/viewer";

import { ConsoleClient } from "./console-client";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const { workspace } = await requireOwner();
  const store = await getStore();
  const knownUsers = Object.values(store.users)
    .filter((u) => u.workspaceId === workspace.id && u.externalId)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((u) => u.externalId!)
    .slice(0, 50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Console</h1>
        <p className="mt-1 text-muted-foreground">
          Act as your app: open any of your users&apos; agents and see exactly what the API streams.
          This rendering is only a reference; your UI decides how each block looks.
        </p>
      </div>
      <ConsoleClient knownUsers={knownUsers} />
    </div>
  );
}
