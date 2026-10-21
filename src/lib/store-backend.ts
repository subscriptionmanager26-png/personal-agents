import { getConfig } from "@/lib/config";

export type StoreBackend = "redis" | "blob" | "file";

function envFlag(name: string) {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** When set, never read/write Vercel Blob (avoids quota/billing on the JSON store and uploads). */
export function blobStoreDisabled() {
  return envFlag("PERSONAL_AGENTS_DISABLE_BLOB");
}

export function redisConfigured() {
  const { upstashUrl, upstashToken } = getConfig();
  return Boolean(upstashUrl && upstashToken);
}

export function blobStoreConfigured() {
  if (blobStoreDisabled()) return false;
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim(),
  );
}

/** Which persistence layer `getStore` / `updateStore` and file bytes use. */
export function activeStoreBackend(): StoreBackend {
  const forced = process.env.PERSONAL_AGENTS_STORE?.trim().toLowerCase();
  if (forced === "redis" || forced === "blob" || forced === "file") {
    if (forced === "redis" && !redisConfigured()) {
      throw new Error("PERSONAL_AGENTS_STORE=redis but Upstash/KV env vars are missing.");
    }
    if (forced === "blob" && !blobStoreConfigured()) {
      throw new Error("PERSONAL_AGENTS_STORE=blob but Blob is not configured or is disabled.");
    }
    return forced;
  }
  if (redisConfigured()) return "redis";
  if (blobStoreConfigured()) return "blob";
  return "file";
}
