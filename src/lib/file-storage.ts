import { promises as fs } from "node:fs";
import path from "node:path";

import { sha256 } from "@/lib/crypto";

/** Raw uploads and their extracted content: private Vercel Blob, or .data/files locally. */

function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_STORE_ID?.trim());
}

export function fileStorageAvailable() {
  return blobEnabled() || !process.env.VERCEL;
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
  if (process.env.VERCEL) throw new Error("File storage is not configured (set up Vercel Blob).");
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
  await Promise.all(keys.map((k) => fs.rm(path.join(localRoot(), k), { force: true })));
}
