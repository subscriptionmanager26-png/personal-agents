import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

function supabaseUrl() {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.PERSONAL_AGENTS_SUPABASE_URL?.trim() ||
    process.env.POCKETEDGE_SUPABASE_URL?.trim()
  );
}

function supabaseServiceRoleKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.PERSONAL_AGENTS_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.POCKETEDGE_SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export function supabaseStoreConfigured() {
  return Boolean(supabaseUrl() && supabaseServiceRoleKey());
}

/** For /api/health/store — which env pieces are present (no secret values). */
export function supabaseEnvStatus() {
  return { url: Boolean(supabaseUrl()), serviceRoleKey: Boolean(supabaseServiceRoleKey()) };
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error(
      "Supabase store env missing (SUPABASE_URL or POCKETEDGE_SUPABASE_URL + service role key).",
    );
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export const SUPABASE_STORE_ROW_ID = "main";
export const SUPABASE_FILES_BUCKET =
  process.env.PERSONAL_AGENTS_SUPABASE_FILES_BUCKET?.trim() || "personal-agents-files";
