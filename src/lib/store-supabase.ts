import { coerceStoreData, emptyStoreData } from "@/lib/store-coerce";
import { StoreReadError } from "@/lib/store-errors";
import {
  readRelationalStore,
  relationalStoreEnabled,
  relationalTablesReady,
  writeRelationalStore,
} from "@/lib/store-relational";
import type { StoreData } from "@/lib/types";
import { getSupabaseAdmin, SUPABASE_STORE_ROW_ID } from "@/lib/supabase-admin";

async function readBlobRow(): Promise<StoreData> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("personal_agents_store")
    .select("data")
    .eq("id", SUPABASE_STORE_ROW_ID)
    .maybeSingle();

  if (error) {
    if (/relation.*does not exist|42P01/i.test(error.message)) {
      throw new StoreReadError(
        "store_read_failed",
        "Table personal_agents_store missing. Run scripts/supabase-store-migration.sql in Supabase.",
      );
    }
    throw new StoreReadError("store_read_failed", error.message);
  }
  if (!data?.data) return emptyStoreData();
  return coerceStoreData(data.data);
}

export async function readSupabaseStore(): Promise<StoreData> {
  if (relationalStoreEnabled() && (await relationalTablesReady())) {
    try {
      return await readRelationalStore();
    } catch (error) {
      console.error("[store-supabase] relational read failed; falling back to blob", error);
    }
  }
  return readBlobRow();
}

export async function writeSupabaseStore(store: StoreData): Promise<void> {
  const supabase = getSupabaseAdmin();
  const tablesReady = await relationalTablesReady().catch(() => false);

  // Dual-write: relational tables (primary once ready) + legacy blob for rollback.
  if (tablesReady) {
    try {
      await writeRelationalStore(store);
    } catch (error) {
      console.error("[store-supabase] relational write failed", error);
      if (relationalStoreEnabled()) {
        throw new StoreReadError(
          "store_read_failed",
          error instanceof Error ? error.message : "Relational store write failed",
        );
      }
    }
  }

  // Keep blob while dual-writing unless explicitly disabled.
  const skipBlob = process.env.PERSONAL_AGENTS_SKIP_BLOB_WRITE?.trim() === "1";
  if (!skipBlob) {
    const { error } = await supabase.from("personal_agents_store").upsert({
      id: SUPABASE_STORE_ROW_ID,
      data: store,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      throw new StoreReadError("store_read_failed", `Supabase write failed: ${error.message}`);
    }
  }
}
