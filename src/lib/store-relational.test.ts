import assert from "node:assert/strict";
import test from "node:test";

import { MAX_JOBS_PER_USER, relationalStoreEnabled } from "@/lib/store-relational";

test("relational reads are opt-in via PERSONAL_AGENTS_RELATIONAL", () => {
  const prev = process.env.PERSONAL_AGENTS_RELATIONAL;
  delete process.env.PERSONAL_AGENTS_RELATIONAL;
  assert.equal(relationalStoreEnabled(), false);
  process.env.PERSONAL_AGENTS_RELATIONAL = "1";
  // Still false without supabase env in unit test
  assert.equal(relationalStoreEnabled(), false);
  if (prev === undefined) delete process.env.PERSONAL_AGENTS_RELATIONAL;
  else process.env.PERSONAL_AGENTS_RELATIONAL = prev;
});

test("per-user job cap is bounded for free-tier", () => {
  assert.ok(MAX_JOBS_PER_USER >= 20 && MAX_JOBS_PER_USER <= 500);
});
