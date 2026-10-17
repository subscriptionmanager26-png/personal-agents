import { promises as fs } from "node:fs";
import path from "node:path";

import { sha256 } from "@/lib/crypto";
import { getRedis } from "@/lib/store";

/** Raw uploads and extracted content: Vercel Blob, Upstash (prod), or .data/files locally. */

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim());
}

function redisObjectKey(key: string) {
  return `personal-agents:file:${key}`;
}

export function fileStorageAvailable() {
  return blobEnabled() || Boolean(getRedis()) || !process.env.VERCEL;
}

function localRoot() {
  return path.join(process.env.PERSONAL_AGENTS_DATA_DIR?.trim() || path.join(process.cwd(), ".data"), "files");
}

/** Storage key for one file's object; owner ids are hashed so they never appear in paths. */
export function fileKey(ownerUserId: string, fileId: string, part: "raw" | "extract") {
  return `personal-agents/files/${sha256(ownerUserId).toString("hex").slice(0, 32)}/${fileId}/${part}`;
}

export async function putObject(key: string, data: Buffer | string, contentType: string) {
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    await put(key, data, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
    return;
  }
  const redis = getRedis();
  if (redis) {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await redis.set(redisObjectKey(key), {
      contentType,
      b64: bytes.toString("base64"),
    });
    return;
  }
  if (process.env.VERCEL) throw new Error("File storage is not configured (set up Vercel Blob or Upstash Redis).");
  const file = path.join(localRoot(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

export async function getObject(key: string): Promise<Buffer | undefined> {
  if (blobEnabled()) {
    const { get } = await import("@vercel/blob");
    try {
      const result = await get(key, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return undefined;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      return undefined;
    }
  }
  const redis = getRedis();
  if (redis) {
    const row = await redis.get<{ b64?: string }>(redisObjectKey(key));
    if (!row?.b64) return undefined;
    return Buffer.from(row.b64, "base64");
  }
  try {
    return await fs.readFile(path.join(localRoot(), key));
  } catch {
    return undefined;
  }
}

export async function deleteObjects(keys: string[]) {
  if (!keys.length) return;
  if (blobEnabled()) {
    const { del } = await import("@vercel/blob");
    await del(keys).catch(() => undefined);
    return;
  }
  const redis = getRedis();
  if (redis) {
    await Promise.all(keys.map((k) => redis.del(redisObjectKey(k))));
    return;
  }
  await Promise.all(keys.map((k) => fs.rm(path.join(localRoot(), k), { force: true })));
}
