import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function supabaseStoreConfigured() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.PERSONAL_AGENTS_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.PERSONAL_AGENTS_SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(url && key);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim() || process.env.PERSONAL_AGENTS_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.PERSONAL_AGENTS_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Supabase store env missing (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export const SUPABASE_STORE_ROW_ID = "main";
export const SUPABASE_FILES_BUCKET =
  process.env.PERSONAL_AGENTS_SUPABASE_FILES_BUCKET?.trim() || "personal-agents-files";
