import assert from "node:assert/strict";
import test from "node:test";

import { coerceStoreData } from "@/lib/store-coerce";

test("coerceStoreData repairs null jobs array", () => {
  const store = coerceStoreData({ jobs: null });
  assert.equal(Array.isArray(store.jobs), true);
  assert.equal(store.jobs.length, 0);
  assert.doesNotThrow(() => store.jobs.filter(() => true));
});
