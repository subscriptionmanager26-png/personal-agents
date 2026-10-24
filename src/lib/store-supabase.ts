import { coerceStoreData, emptyStoreData } from "@/lib/store-coerce";
import { StoreReadError } from "@/lib/store-errors";
import type { StoreData } from "@/lib/types";
import { getSupabaseAdmin, SUPABASE_STORE_ROW_ID } from "@/lib/supabase-admin";

export async function readSupabaseStore(): Promise<StoreData> {
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

export async function writeSupabaseStore(store: StoreData): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("personal_agents_store").upsert({
    id: SUPABASE_STORE_ROW_ID,
    data: store,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    throw new StoreReadError("store_read_failed", `Supabase write failed: ${error.message}`);
  }
}
