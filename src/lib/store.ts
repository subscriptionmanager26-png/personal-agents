import { promises as fs } from "node:fs";
import path from "node:path";

import { Redis } from "@upstash/redis";

import { getConfig } from "@/lib/config";
import { activeStoreBackend } from "@/lib/store-backend";
import { StoreReadError } from "@/lib/store-errors";
import { coerceStoreData, emptyStoreData } from "@/lib/store-coerce";
import { readSupabaseStore, writeSupabaseStore } from "@/lib/store-supabase";
import type { StoreData } from "@/lib/types";

const STORE_KEY = "personal-agents:store";
const BLOB_PATHNAME = "personal-agents/store.json";

function localPath() {
  const root =
    process.env.PERSONAL_AGENTS_DATA_DIR?.trim() ||
    path.join(process.cwd(), ".data");
  return path.join(root, "store.json");
}

const emptyStore = emptyStoreData;

let redisClient: Redis | null | undefined;
let queue: Promise<unknown> = Promise.resolve();

export function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const { upstashUrl, upstashToken } = getConfig();
  if (!upstashUrl || !upstashToken) {
    redisClient = null;
    return null;
  }
  redisClient = new Redis({ url: upstashUrl, token: upstashToken });
  return redisClient;
}

async function readLocal(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(localPath(), "utf8");
    return coerceStoreData(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

async function writeLocal(data: StoreData) {
  const file = localPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

async function readBlob(): Promise<StoreData> {
  const { get } = await import("@vercel/blob");
  try {
    const result = await get(BLOB_PATHNAME, {
      access: "private",
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return emptyStore();
    }
    const text = await new Response(result.stream).text();
    if (!text.trim()) return emptyStore();
    try {
      return coerceStoreData(JSON.parse(text));
    } catch (parseError) {
      console.error("[store] corrupt blob JSON", parseError);
      throw new StoreReadError("store_read_failed", "Persisted store JSON is corrupt.");
    }
  } catch (error) {
    if (error instanceof StoreReadError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    // Missing blob is a cold start, not a hard failure.
    if (/not found|404|NoSuchKey|does not exist/i.test(message)) {
      return emptyStore();
    }
    console.error("[store] blob read failed", error);
    throw new StoreReadError(
      "blob_unavailable",
      /suspended|quota|limit|forbidden|402|403|unauthorized/i.test(message)
        ? "Blob store is unavailable (billing or quota). Restore Vercel Blob for this project."
        : `Blob store read failed: ${message}`,
    );
  }
}

async function writeBlob(data: StoreData) {
  const { put } = await import("@vercel/blob");
  await put(BLOB_PATHNAME, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function getStore(): Promise<StoreData> {
  try {
    const backend = activeStoreBackend();
    if (backend === "redis") {
      const redis = getRedis();
      if (!redis) {
        throw new StoreReadError("store_read_failed", "Redis store is configured but the client failed to initialize.");
      }
      const data = await redis.get<StoreData>(STORE_KEY);
      return data ? coerceStoreData(data) : emptyStore();
    }
    if (backend === "supabase") return readSupabaseStore();
    if (backend === "blob") return readBlob();
    return readLocal();
  } catch (error) {
    if (error instanceof StoreReadError) throw error;
    console.error("[store] getStore failed", error);
    throw new StoreReadError("store_read_failed", error instanceof Error ? error.message : String(error));
  }
}

export async function updateStore<T>(
  fn: (store: StoreData) => T | Promise<T>,
): Promise<T> {
  const run = async () => {
    const backend = activeStoreBackend();
    const current = await getStore();
    const result = await fn(current);
    if (backend === "redis") {
      const redis = getRedis();
      if (!redis) throw new StoreReadError("store_read_failed", "Redis client unavailable during write.");
      await redis.set(STORE_KEY, current);
    } else if (backend === "supabase") {
      await writeSupabaseStore(current);
    } else if (backend === "blob") {
      await writeBlob(current);
    } else {
      await writeLocal(current);
    }
    return result;
  };

  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function activeBackend() {
  return activeStoreBackend();
}
