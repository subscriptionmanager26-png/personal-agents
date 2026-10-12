import { apiError } from "@/lib/api-auth";
import { getApiUser } from "@/lib/company";
import { requireOwner } from "@/lib/viewer";

/** The owner's console acts as their backend: same calls, authorised by the owner session. */
export async function consoleUser(externalId: string | null | undefined) {
  const { workspace } = await requireOwner();
  const user = externalId ? await getApiUser(workspace, externalId) : undefined;
  if (!user) return { response: apiError(404, "user_not_found", "Create the user first.") } as const;
  return { workspace, user } as const;
}
