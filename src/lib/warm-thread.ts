import { specialistForThread } from "@/lib/specialist-agents";
import { getWebThread, webThreadSource } from "@/lib/web-threads";
import { getUser } from "@/lib/users";

/** Cheap reads so the first send on a thread hits warm store / bindings. */
export async function warmAgentThread(ownerUserId: string, threadId: string) {
  await getUser(ownerUserId);
  const source = webThreadSource("api");
  const thread = await getWebThread(ownerUserId, source, threadId);
  const specialist = specialistForThread(threadId);
  return {
    ok: true as const,
    threadId,
    hasAgent: Boolean(thread?.cursorAgentId),
    specialist: specialist?.kind ?? null,
  };
}