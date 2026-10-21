/**
 * Copy the control-plane JSON store into Upstash Redis (recommended production backend).
 *
 *   npx tsx --env-file=.env.local scripts/migrate-store-to-redis.ts
 *   npx tsx --env-file=.env.local scripts/migrate-store-to-redis.ts --from=blob
 *   npx tsx --env-file=.env.local scripts/migrate-store-to-redis.ts --from=local
 *
 * After a successful run, set on Vercel (personal-agents project):
 *   PERSONAL_AGENTS_STORE=redis
 *   PERSONAL_AGENTS_DISABLE_BLOB=1
 * and remove or ignore BLOB_STORE_ID so quota cannot take the app down again.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { Redis } from "@upstash/redis";

import { getConfig } from "@/lib/config";
import { coerceStoreData } from "@/lib/store-coerce";

const STORE_KEY = "personal-agents:store";
const BLOB_PATHNAME = "personal-agents/store.json";

function localPath() {
  const root = process.env.PERSONAL_AGENTS_DATA_DIR?.trim() || path.join(process.cwd(), ".data");
  return path.join(root, "store.json");
}

async function readLocal() {
  const raw = await fs.readFile(localPath(), "utf8");
  return coerceStoreData(JSON.parse(raw));
}

async function readBlob() {
  const { get } = await import("@vercel/blob");
  const result = await get(BLOB_PATHNAME, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("Blob store.json not found (404).");
  }
  const text = await new Response(result.stream).text();
  return coerceStoreData(JSON.parse(text));
}

function redisClient() {
  const { upstashUrl, upstashToken } = getConfig();
  if (!upstashUrl || !upstashToken) {
    throw new Error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_* from Vercel).");
  }
  return new Redis({ url: upstashUrl, token: upstashToken });
}

async function main() {
  const fromArg = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1] || "auto";
  const redis = redisClient();

  let data;
  if (fromArg === "local") {
    data = await readLocal();
    console.log(`Read store from ${localPath()}`);
  } else if (fromArg === "blob") {
    data = await readBlob();
    console.log("Read store from Vercel Blob");
  } else {
    try {
      data = await readLocal();
      console.log(`Read store from ${localPath()}`);
    } catch {
      data = await readBlob();
      console.log("Read store from Vercel Blob");
    }
  }

  const users = Object.keys(data.users).length;
  const jobs = data.jobs.length;
  const workspaces = Object.keys(data.workspaces).length;

  await redis.set(STORE_KEY, data);
  console.log(`Wrote Redis key ${STORE_KEY}: ${users} users, ${workspaces} workspaces, ${jobs} jobs.`);
  console.log("Next: set PERSONAL_AGENTS_STORE=redis and PERSONAL_AGENTS_DISABLE_BLOB=1 on Vercel, then redeploy.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
