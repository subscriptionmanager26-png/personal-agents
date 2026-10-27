/**
 * One-shot: copy personal_agents_store blob → pa_* tables.
 *
 *   npx tsx --env-file=.env.local scripts/migrate-blob-to-relational.ts
 *
 * Requires Supabase service role env + pa_* tables from
 * scripts/supabase-relational-store-migration.sql
 */
import { coerceStoreData, emptyStoreData } from "../src/lib/store-coerce";
import { getSupabaseAdmin, SUPABASE_STORE_ROW_ID } from "../src/lib/supabase-admin";
import { writeRelationalStore, relationalTablesReady } from "../src/lib/store-relational";

async function readBlobOnly() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("personal_agents_store")
    .select("data")
    .eq("id", SUPABASE_STORE_ROW_ID)
    .maybeSingle();
  if (error) throw error;
  if (!data?.data) return emptyStoreData();
  return coerceStoreData(data.data);
}

async function main() {
  if (!(await relationalTablesReady())) {
    console.error("pa_* tables missing. Run scripts/supabase-relational-store-migration.sql first.");
    process.exit(1);
  }
  console.log("Reading legacy blob…");
  const store = await readBlobOnly();
  console.log(
    `users=${Object.keys(store.users).length} jobs=${store.jobs.length} threads=${Object.keys(store.webThreads).length}`,
  );
  console.log("Writing relational tables…");
  await writeRelationalStore(store);
  console.log(
    "Done. Set PERSONAL_AGENTS_RELATIONAL=1 on Vercel, verify /ai, then optionally PERSONAL_AGENTS_SKIP_BLOB_WRITE=1.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
