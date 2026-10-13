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
  const suggestions = [
    ...workspace.skills.slice(0, 3).map((s) => `Help me with ${s.name.toLowerCase()}`),
    "What can you do for me?",
  ];

  return <ConsoleClient knownUsers={knownUsers} suggestions={suggestions} />;
}
