import { apiError, requireApiUserForThreads } from "@/lib/api-auth";
import { isStoreReadError } from "@/lib/store-errors";
import { listApiChatThreads } from "@/lib/api-threads";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Params) {
  const t0 = Date.now();
  let authMs = 0;
  let indexMs = 0;
  try {
    const authStart = Date.now();
    const auth = await requireApiUserForThreads(request, (await params).userId);
    authMs = Date.now() - authStart;
    if ("response" in auth) {
      auth.response.headers.set("Server-Timing", `auth;dur=${authMs},total;dur=${Date.now() - t0}`);
      return auth.response;
    }

    const indexStart = Date.now();
    const threads = await listApiChatThreads(auth.ownerUserId);
    indexMs = Date.now() - indexStart;

    const body = JSON.stringify({ threads });
    const etag = `"t${threads.length}-${hashQuick(body)}"`;
    const inm = normalizeEtag(request.headers.get("if-none-match"));
    if (inm && inm === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "private, no-cache",
          "Server-Timing": `auth;dur=${authMs},index;dur=${indexMs},total;dur=${Date.now() - t0}`,
        },
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ETag: etag,
        "Cache-Control": "private, no-cache",
        "Server-Timing": `auth;dur=${authMs},index;dur=${indexMs},total;dur=${Date.now() - t0}`,
      },
    });
  } catch (error) {
    console.error("[v1/users/threads]", error);
    if (isStoreReadError(error)) return apiError(503, error.code, error.message);
    return apiError(500, "internal_error", "Could not list chat threads.");
  }
}

/** Fast non-crypto digest for ETag (not a security boundary). */
function hashQuick(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Vercel/CDN may prefix ETags with W/; browsers echo that on If-None-Match. */
function normalizeEtag(value: string | null) {
  if (!value) return null;
  const first = value.split(",")[0]?.trim() ?? "";
  return first.replace(/^W\//i, "") || null;
}
