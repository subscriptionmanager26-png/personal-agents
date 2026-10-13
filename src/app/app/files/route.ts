import { apiError } from "@/lib/api-auth";
import { handleUnlock, handleUpload } from "@/lib/file-routes";
import { getFile, readRaw } from "@/lib/files";
import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

async function sessionUser() {
  const session = await getSession();
  return session ? await getUser(session.id) : undefined;
}

/** Web chat uploads for the signed-in user; `?unlock=<fileId>` with `{ password }`. */
export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return apiError(401, "unauthorized", "Sign in again.");
  const unlock = new URL(request.url).searchParams.get("unlock");
  return unlock ? handleUnlock(request, user, unlock) : handleUpload(request, user);
}

/** `?download=<fileId>`: one of the signed-in user's own uploads. */
export async function GET(request: Request) {
  const user = await sessionUser();
  if (!user) return apiError(401, "unauthorized", "Sign in again.");
  const fileId = new URL(request.url).searchParams.get("download") || "";
  const file = fileId ? await getFile(user.id, fileId) : undefined;
  const bytes = file ? await readRaw(file) : undefined;
  if (!file || !bytes) return apiError(404, "not_found", "No such file.");
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
