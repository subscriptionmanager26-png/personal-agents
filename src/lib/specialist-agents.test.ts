import assert from "node:assert/strict";
import test from "node:test";

import { specialistForThread } from "@/lib/specialist-agents";

test("MF threads use the Mutualfundscreener repo", () => {
  delete process.env.MF_AGENT_REPOSITORY;
  delete process.env.MF_AGENT_REF;
  const spec = specialistForThread("adv_mf");
  assert.ok(spec);
  assert.equal(spec.kind, "mf");
  assert.equal(spec.ref, "main");
  assert.equal(spec.url, "https://github.com/subscriptionmanager26-png/Mutualfundscreener");
  assert.equal(specialistForThread("adv_mf_extra")?.kind, "mf");
});

test("other threads stay on the main agent", () => {
  assert.equal(specialistForThread("main"), undefined);
  assert.equal(specialistForThread("adv_general"), undefined);
  assert.equal(specialistForThread("adv_trader"), undefined);
  assert.equal(specialistForThread("adv_stock"), undefined);
  assert.equal(specialistForThread(undefined), undefined);
});

test("MF repo and ref can be overridden", () => {
  process.env.MF_AGENT_REPOSITORY = "https://github.com/example/Mutualfundscreener";
  process.env.MF_AGENT_REF = "snapshot";
  const spec = specialistForThread("adv_mf");
  assert.equal(spec?.url, "https://github.com/example/Mutualfundscreener");
  assert.equal(spec?.ref, "snapshot");
  delete process.env.MF_AGENT_REPOSITORY;
  delete process.env.MF_AGENT_REF;
});
