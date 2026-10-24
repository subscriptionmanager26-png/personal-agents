import { activeStoreBackend, blobStoreConfigured, blobStoreDisabled, redisConfigured } from "@/lib/store-backend";
import { supabaseStoreConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/** Public ops probe — no secrets. */
export async function GET() {
  let backend: string;
  try {
    backend = activeStoreBackend();
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        blobDisabled: blobStoreDisabled(),
        redis: redisConfigured(),
        supabase: supabaseStoreConfigured(),
        blob: blobStoreConfigured(),
      },
      { status: 503 },
    );
  }
  return Response.json({
    ok: true,
    backend,
    blobDisabled: blobStoreDisabled(),
    redis: redisConfigured(),
    supabase: supabaseStoreConfigured(),
    blob: blobStoreConfigured(),
  });
}
