import { apiError } from "@/lib/api-auth";
import { handleUnlock, handleUpload } from "@/lib/file-routes";
import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Web chat uploads for the signed-in user; `?unlock=<fileId>` with `{ password }`. */
export async function POST(request: Request) {
  const session = await getSession();
  const user = session ? await getUser(session.id) : undefined;
  if (!user) return apiError(401, "unauthorized", "Sign in again.");
  const unlock = new URL(request.url).searchParams.get("unlock");
  return unlock ? handleUnlock(request, user, unlock) : handleUpload(request, user);
}
