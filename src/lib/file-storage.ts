import { promises as fs } from "node:fs";
import path from "node:path";

import { sha256 } from "@/lib/crypto";
import { activeStoreBackend } from "@/lib/store-backend";
import { getSupabaseAdmin, SUPABASE_FILES_BUCKET } from "@/lib/supabase-admin";
import { getRedis } from "@/lib/store";

/** Raw uploads and extracted content: Upstash (preferred), Vercel Blob, or .data/files locally. */

export function fileStorageAvailable() {
  const backend = activeStoreBackend();
  if (backend === "redis") return Boolean(getRedis());
  if (backend === "supabase") return true;
  if (backend === "blob") return true;
  return !process.env.VERCEL;
}

function localRoot() {
  return path.join(process.env.PERSONAL_AGENTS_DATA_DIR?.trim() || path.join(process.cwd(), ".data"), "files");
}

function redisObjectKey(key: string) {
  return `personal-agents:file:${key}`;
}

/** Storage key for one file's object; owner ids are hashed so they never appear in paths. */
export function fileKey(ownerUserId: string, fileId: string, part: "raw" | "extract") {
  return `personal-agents/files/${sha256(ownerUserId).toString("hex").slice(0, 32)}/${fileId}/${part}`;
}

async function putRedis(key: string, data: Buffer | string, contentType: string) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis file storage is not available.");
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  await redis.set(redisObjectKey(key), {
    contentType,
    b64: bytes.toString("base64"),
  });
}

async function getRedisObject(key: string): Promise<Buffer | undefined> {
  const redis = getRedis();
  if (!redis) return undefined;
  const row = await redis.get<{ b64?: string }>(redisObjectKey(key));
  if (!row?.b64) return undefined;
  return Buffer.from(row.b64, "base64");
}

let filesBucketReady: Promise<void> | null = null;

/** Create the private files bucket once if the store migration was never applied. */
async function ensureFilesBucket() {
  if (!filesBucketReady) {
    filesBucketReady = (async () => {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.storage.listBuckets();
      if (error) throw new Error(`Supabase list buckets failed: ${error.message}`);
      if (data?.some((b) => b.name === SUPABASE_FILES_BUCKET)) return;
      const { error: createError } = await supabase.storage.createBucket(SUPABASE_FILES_BUCKET, {
        public: false,
        fileSizeLimit: 5 * 1024 * 1024,
      });
      // Concurrent creates can race; "already exists" is fine.
      if (createError && !/already exists|duplicate/i.test(createError.message)) {
        throw new Error(`Supabase create bucket failed: ${createError.message}`);
      }
    })().catch((err) => {
      filesBucketReady = null;
      throw err;
    });
  }
  await filesBucketReady;
}

async function putSupabase(key: string, data: Buffer | string, contentType: string) {
  await ensureFilesBucket();
  const supabase = getSupabaseAdmin();
  const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const { error } = await supabase.storage.from(SUPABASE_FILES_BUCKET).upload(key, body, {
    upsert: true,
    contentType,
  });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      filesBucketReady = null;
      await ensureFilesBucket();
      const retry = await supabase.storage.from(SUPABASE_FILES_BUCKET).upload(key, body, {
        upsert: true,
        contentType,
      });
      if (!retry.error) return;
      throw new Error(`Supabase file upload failed: ${retry.error.message}`);
    }
    throw new Error(`Supabase file upload failed: ${error.message}`);
  }
}

async function getSupabaseObject(key: string): Promise<Buffer | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(SUPABASE_FILES_BUCKET).download(key);
  if (error || !data) return undefined;
  return Buffer.from(await data.arrayBuffer());
}

export async function putObject(key: string, data: Buffer | string, contentType: string) {
  const backend = activeStoreBackend();
  if (backend === "redis") {
    await putRedis(key, data, contentType);
    return;
  }
  if (backend === "supabase") {
    await putSupabase(key, data, contentType);
    return;
  }
  if (backend === "blob") {
    const { put } = await import("@vercel/blob");
    await put(key, data, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
    return;
  }
  if (process.env.VERCEL) {
    throw new Error(
      "File storage is not configured. Add Upstash Redis (recommended) or enable Blob on this project.",
    );
  }
  const file = path.join(localRoot(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

export async function getObject(key: string): Promise<Buffer | undefined> {
  const backend = activeStoreBackend();
  if (backend === "redis") return getRedisObject(key);
  if (backend === "supabase") return getSupabaseObject(key);
  if (backend === "blob") {
    const { get } = await import("@vercel/blob");
    try {
      const result = await get(key, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return undefined;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      return undefined;
    }
  }
  try {
    return await fs.readFile(path.join(localRoot(), key));
  } catch {
    return undefined;
  }
}

export async function deleteObjects(keys: string[]) {
  if (!keys.length) return;
  const backend = activeStoreBackend();
  if (backend === "redis") {
    const redis = getRedis();
    if (redis) await Promise.all(keys.map((k) => redis.del(redisObjectKey(k))));
    return;
  }
  if (backend === "supabase") {
    const supabase = getSupabaseAdmin();
    await supabase.storage.from(SUPABASE_FILES_BUCKET).remove(keys).catch(() => undefined);
    return;
  }
  if (backend === "blob") {
    const { del } = await import("@vercel/blob");
    await del(keys).catch(() => undefined);
    return;
  }
  await Promise.all(keys.map((k) => fs.rm(path.join(localRoot(), k), { force: true })));
}
