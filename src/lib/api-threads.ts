import {
  isSidebarThread,
  readThreadIndex,
  rebuildThreadIndex,
  relationalStoreEnabled,
} from "@/lib/store-relational";
import { listWebThreadsForUser } from "@/lib/web-threads";

export type ApiChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  working: boolean;
};

/**
 * Pocketedge www (`source: api`) conversations — metadata only.
 * Hot path: primary-key read of `pa:idx:threads:…` (no blob, no LIKE scan).
 * Miss: rebuild index from `pa:t:*` once, then fall back to blob list.
 */
export async function listApiChatThreads(ownerUserId: string, limit = 40): Promise<ApiChatThread[]> {
  if (relationalStoreEnabled()) {
    try {
      const indexed = await readThreadIndex(ownerUserId, "api", limit);
      if (indexed) return indexed;
      return await rebuildThreadIndex(ownerUserId, "api", limit);
    } catch (error) {
      console.error("[api-threads] index read failed; falling back", error);
    }
  }

  const threads = await listWebThreadsForUser(ownerUserId, "api", [], limit);
  return threads.filter(isSidebarThread);
}
