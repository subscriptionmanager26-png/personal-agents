import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PERSONAL_AGENTS_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "pa-vault-"),
);
process.env.SESSION_SECRET = "test-session-secret-vault-blind";
process.env.VAULT_MASTER_KEY = "test-vault-master-blind";
process.env.PUBLIC_URL = "https://example.test";
process.env.CURSOR_API_KEY = "";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

test("agent prompt never contains vault JWTs or plaintext secrets", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createVaultItem } = await import("@/lib/vault");
  const { createJob } = await import("@/lib/jobs");
  const { buildPersonalAgentPrompt } = await import("@/lib/prompt");

  const created = await registerUserWithEmail({
    email: "vault@example.com",
    password: "password-vault-1",
    displayName: "Vault User",
  });
  assert.ok("user" in created);
  const user = created.user;

  await createVaultItem({
    ownerUserId: user.id,
    label: "broker-api",
    username: "ada",
    origin: "https://api.broker.com",
    secret: "super-secret-password-xyz",
  });

  const job = await createJob({
    ownerUserId: user.id,
    source: "web",
    prompt: "check my balance",
  });

  const prompt = await buildPersonalAgentPrompt(user, job);
  assert.match(prompt, /handle=vault_/);
  assert.match(prompt, /label="broker-api"/);
  assert.match(prompt, /origin=https:\/\/api\.broker\.com/);
  assert.doesNotMatch(prompt, /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  assert.doesNotMatch(prompt, /super-secret-password-xyz/);
  assert.doesNotMatch(prompt, /Bearer eyJ/);
  assert.doesNotMatch(prompt, /PA_VAULT_JOB_TOKEN\s*=/);
  assert.match(prompt, /vault_fill/);
  assert.match(prompt, /personal-vault/);
  assert.match(prompt, /model-blind/i);
});

test("plaintext reveal API is disabled", async () => {
  const { POST } = await import("@/app/api/agent/vault/reveal/route");
  const res = await POST();
  assert.equal(res.status, 410);
  const body = await res.json();
  assert.equal(body.error, "plaintext_reveal_disabled");
});
