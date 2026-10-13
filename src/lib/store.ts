import { promises as fs } from "node:fs";
import path from "node:path";

import { Redis } from "@upstash/redis";

import { getConfig } from "@/lib/config";
import type { StoreData } from "@/lib/types";

const STORE_KEY = "personal-agents:store";
const BLOB_PATHNAME = "personal-agents/store.json";

function localPath() {
  const root =
    process.env.PERSONAL_AGENTS_DATA_DIR?.trim() ||
    path.join(process.cwd(), ".data");
  return path.join(root, "store.json");
}

const emptyStore = (): StoreData => ({
  users: {},
  files: {},
  workspaces: {},
  memories: {},
  vaultItems: {},
  connections: {},
  orders: {},
  jobs: [],
  slackThreads: {},
  slackInstalls: {},
  processedSlackMessages: [],
  auditEvents: [],
});

let redisClient: Redis | null | undefined;
let queue: Promise<unknown> = Promise.resolve();

function blobEnabled() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim(),
  );
}

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
    return { ...emptyStore(), ...(JSON.parse(raw) as StoreData) };
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
    const parsed = JSON.parse(text) as StoreData;
    return { ...emptyStore(), ...parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Missing blob is a cold start, not a hard failure.
    if (/not found|404|NoSuchKey|does not exist/i.test(message)) {
      return emptyStore();
    }
    throw error;
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
  const redis = getRedis();
  if (redis) {
    const data = await redis.get<StoreData>(STORE_KEY);
    return data ? { ...emptyStore(), ...data } : emptyStore();
  }
  if (blobEnabled()) return readBlob();
  return readLocal();
}

export async function updateStore<T>(
  fn: (store: StoreData) => T | Promise<T>,
): Promise<T> {
  const run = async () => {
    const redis = getRedis();
    const current = await getStore();
    const result = await fn(current);
    if (redis) {
      await redis.set(STORE_KEY, current);
    } else if (blobEnabled()) {
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
  if (getRedis()) return "redis";
  if (blobEnabled()) return "blob";
  return "file";
}
