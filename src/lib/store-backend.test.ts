import assert from "node:assert/strict";
import test from "node:test";

process.env.BLOB_STORE_ID = "store_test";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

test("blob is skipped when PERSONAL_AGENTS_DISABLE_BLOB=1", async () => {
  process.env.PERSONAL_AGENTS_DISABLE_BLOB = "1";
  const { activeStoreBackend, blobStoreConfigured } = await import("@/lib/store-backend");
  assert.equal(blobStoreConfigured(), false);
  assert.equal(activeStoreBackend(), "file");
  delete process.env.PERSONAL_AGENTS_DISABLE_BLOB;
});

test("redis wins when configured", async () => {
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  const { activeStoreBackend } = await import("@/lib/store-backend");
  assert.equal(activeStoreBackend(), "redis");
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
});
