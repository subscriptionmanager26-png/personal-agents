/**
 * Copy the control-plane JSON store into Supabase Postgres.
 *
 *   npx tsx --env-file=.env.local scripts/migrate-store-to-supabase.ts
 *
 * Requires scripts/supabase-store-migration.sql applied once.
 * Then set PERSONAL_AGENTS_STORE=supabase and PERSONAL_AGENTS_DISABLE_BLOB=1 on Vercel.
 */
import { readSupabaseStore, writeSupabaseStore } from "@/lib/store-supabase";
import { coerceStoreData, emptyStoreData } from "@/lib/store-coerce";
import { supabaseStoreConfigured } from "@/lib/supabase-admin";

// Reuse blob/local readers from migrate-store-to-redis pattern
import { promises as fs } from "node:fs";
import path from "node:path";

const BLOB_PATHNAME = "personal-agents/store.json";

function localPath() {
  const root = process.env.PERSONAL_AGENTS_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
  return path.join(root, "store.json");
}

async function readLocal() {
  const raw = await fs.readFile(localPath(), "utf8");
  return coerceStoreData(JSON.parse(raw));
}

async function readBlob() {
  const { get } = await import("@vercel/blob");
  const result = await get(BLOB_PATHNAME, { access: "private", useCache: false });
  if (!result?.stream) throw new Error("Blob store.json not found");
  const text = await new Response(result.stream).text();
  return coerceStoreData(JSON.parse(text));
}

async function main() {
  if (!supabaseStoreConfigured()) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or PERSONAL_AGENTS_SUPABASE_*).");
  }

  const fromArg = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1] || "auto";
  let data = emptyStoreData();
  if (fromArg === "local") {
    data = await readLocal();
  } else if (fromArg === "blob") {
    data = await readBlob();
  } else {
    try {
      data = await readLocal();
    } catch {
      data = await readBlob();
    }
  }

  const existing = await readSupabaseStore().catch(() => emptyStoreData());
  if (existing.jobs.length && data.jobs.length) {
    console.warn("Supabase already has data; overwriting with migrated snapshot.");
  }

  await writeSupabaseStore(data);
  console.log(
    `Wrote Supabase personal_agents_store: ${Object.keys(data.users).length} users, ${data.jobs.length} jobs.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
