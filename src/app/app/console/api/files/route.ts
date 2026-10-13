import { handleUnlock, handleUpload } from "@/lib/file-routes";

import { consoleUser } from "../shared";

export const dynamic = "force-dynamic";

/** `?user=` upload, or `?user=&unlock=<fileId>` with `{ password }`. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const resolved = await consoleUser(url.searchParams.get("user"));
  if ("response" in resolved) return resolved.response;
  const unlock = url.searchParams.get("unlock");
  return unlock ? handleUnlock(request, resolved.user, unlock) : handleUpload(request, resolved.user);
}
