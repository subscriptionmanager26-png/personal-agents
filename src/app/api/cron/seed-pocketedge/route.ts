import { getConfig } from "@/lib/config";
import { seedPocketedge } from "@/lib/seed-pocketedge";
import { isStoreReadError } from "@/lib/store-errors";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const cfg = getConfig();
  if (!cfg.cronSecret) return false;
  const auth = request.headers.get("authorization") || "";
  const key = request.headers.get("x-cron-secret") || "";
  return auth === `Bearer ${cfg.cronSecret}` || key === cfg.cronSecret;
}

/** Re-run Pocketedge workspace + API key seed into the active store (Redis/Supabase). */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await seedPocketedge({ writeKeyFile: false });
    return Response.json({ ok: true, ...result, hint: result.apiKeyCreated ? "Update Pramaan PERSONAL_AGENTS_API_KEY" : undefined });
  } catch (error) {
    console.error("[cron/seed-pocketedge]", error);
    if (isStoreReadError(error)) {
      return Response.json({ ok: false, code: error.code, message: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
