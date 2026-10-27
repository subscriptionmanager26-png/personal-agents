import { listWebThreadsForUser } from "@/lib/web-threads";

export type ApiChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  working: boolean;
};

/**
 * Pocketedge www (`source: api`) conversations — metadata only.
 * Prefers relational `pa:t:*` / `pa_web_threads` rows (no full blob read).
 * Falls back to blob inside listWebThreadsForUser when relational is off/empty.
 * Drops legacy empty `main` placeholders that were created before draft-until-send.
 */
export async function listApiChatThreads(ownerUserId: string, limit = 40): Promise<ApiChatThread[]> {
  const threads = await listWebThreadsForUser(ownerUserId, "api", [], limit);
  return threads.filter((t) => t.id !== "main");
}
