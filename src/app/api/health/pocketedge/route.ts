import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Public ops probe — whether Pocketedge workspace + API keys exist (no secrets). */
export async function GET() {
  try {
    const store = await getStore();
    const ws = Object.values(store.workspaces).find((w) => w.slug === "pocketedge");
    const apiKeyCount = ws?.apiKeys?.length ?? 0;
    return Response.json({
      ok: Boolean(ws && apiKeyCount > 0),
      workspace: Boolean(ws),
      workspaceId: ws?.id,
      apiKeyCount,
      hint:
        apiKeyCount === 0
          ? "POST /api/cron/seed-pocketedge with CRON_SECRET, then set Pramaan PERSONAL_AGENTS_API_KEY to the returned key."
          : undefined,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
