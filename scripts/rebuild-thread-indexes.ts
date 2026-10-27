/**
 * Backfill pa:idx:threads rows from existing pa:t:* shards.
 *
 *   npx tsx --env-file=.env.local scripts/rebuild-thread-indexes.ts
 */
import { getSupabaseAdmin } from "../src/lib/supabase-admin";
import { rebuildThreadIndex, relationalTablesReady } from "../src/lib/store-relational";

async function main() {
  if (!(await relationalTablesReady())) {
    console.error("personal_agents_store missing or unreachable.");
    process.exit(1);
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("personal_agents_store")
    .select("id,data")
    .like("id", "pa:t:%")
    .limit(5000);
  if (error) throw error;

  const pairs = new Map<string, { owner: string; source: "web" | "api" }>();
  for (const row of data ?? []) {
    const thread = (row.data as { kind?: string; thread?: { ownerUserId?: string; source?: string } } | null)
      ?.thread;
    if (!thread?.ownerUserId || (thread.source !== "web" && thread.source !== "api")) continue;
    const key = `${thread.ownerUserId}\0${thread.source}`;
    pairs.set(key, { owner: thread.ownerUserId, source: thread.source });
  }

  console.log(`Rebuilding indexes for ${pairs.size} owner/source pairs…`);
  for (const { owner, source } of pairs.values()) {
    const threads = await rebuildThreadIndex(owner, source);
    console.log(`  ${source} ${owner.slice(0, 48)}… → ${threads.length} threads`);
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
