import { getStoreFresh } from "@/lib/store";
import { listWebThreadsForUser } from "@/lib/web-threads";

export type ApiChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  working: boolean;
};

/**
 * Pocketedge www (`source: api`) conversations — metadata only.
 * Does not scan/reconcile jobs (that would pull the whole blob and call Cursor).
 * Working flags come from webThreads.working when set; otherwise false until settle touches the thread.
 */
export async function listApiChatThreads(ownerUserId: string, limit = 40): Promise<ApiChatThread[]> {
  const store = await getStoreFresh();
  return listWebThreadsForUser(ownerUserId, "api", [], limit, store);
}
