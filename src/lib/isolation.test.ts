import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PERSONAL_AGENTS_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "pa-test-"),
);
process.env.SESSION_SECRET = "test-session-secret";
process.env.VAULT_MASTER_KEY = "test-vault-master";
process.env.CURSOR_API_KEY = "";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

test("memory and vault stay partitioned by owner", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createMemory, listMemories } = await import("@/lib/memory");
  const {
    createVaultItem,
    listVaultItems,
    revealVaultItem,
    createVaultJobToken,
    verifyVaultJobToken,
  } = await import("@/lib/vault");
  const { createJob } = await import("@/lib/jobs");

  const aResult = await registerUserWithEmail({
    email: "ada@example.com",
    password: "password-ada-1",
    displayName: "Ada",
  });
  const bResult = await registerUserWithEmail({
    email: "ben@example.com",
    password: "password-ben-1",
    displayName: "Ben",
  });
  assert.ok("user" in aResult);
  assert.ok("user" in bResult);
  const a = aResult.user;
  const b = bResult.user;
  assert.equal(a.id, "email:ada@example.com");
  assert.equal(b.id, "email:ben@example.com");

  await createMemory({
    ownerUserId: a.id,
    kind: "fact",
    title: "Ada secret fact",
    content: "only for Ada",
  });
  await createMemory({
    ownerUserId: b.id,
    kind: "fact",
    title: "Ben secret fact",
    content: "only for Ben",
  });

  const aMem = await listMemories(a.id);
  const bMem = await listMemories(b.id);
  assert.equal(aMem.length, 1);
  assert.equal(bMem.length, 1);
  assert.equal(aMem[0].content, "only for Ada");
  assert.equal(bMem[0].content, "only for Ben");

  const vaultA = await createVaultItem({
    ownerUserId: a.id,
    label: "broker",
    secret: "ada-password",
  });
  await createVaultItem({
    ownerUserId: b.id,
    label: "broker",
    secret: "ben-password",
  });

  const aItems = await listVaultItems(a.id);
  assert.equal(aItems.length, 1);
  assert.equal(aItems[0].id, vaultA.id);

  const job = await createJob({
    ownerUserId: a.id,
    source: "web",
    prompt: "use vault",
  });

  const token = await createVaultJobToken({
    ownerUserId: a.id,
    jobId: job.id,
  });
  const claims = await verifyVaultJobToken(token);
  assert.ok(claims);
  assert.equal(claims.ownerUserId, a.id);

  const revealed = await revealVaultItem({
    ownerUserId: a.id,
    jobId: job.id,
    itemId: vaultA.id,
  });
  assert.equal(revealed?.secret, "ada-password");

  const cross = await revealVaultItem({
    ownerUserId: b.id,
    jobId: job.id,
    itemId: vaultA.id,
  });
  assert.equal(cross, null);
});

test("email auth rejects wrong password and duplicate signup", async () => {
  const { registerUserWithEmail, authenticateEmailPassword } = await import(
    "@/lib/users"
  );

  const created = await registerUserWithEmail({
    email: "cara@example.com",
    password: "password-cara-1",
  });
  assert.ok("user" in created);

  const dup = await registerUserWithEmail({
    email: "cara@example.com",
    password: "password-cara-2",
  });
  assert.ok("error" in dup);

  const bad = await authenticateEmailPassword({
    email: "cara@example.com",
    password: "wrong-password",
  });
  assert.ok("error" in bad);

  const ok = await authenticateEmailPassword({
    email: "Cara@Example.com",
    password: "password-cara-1",
  });
  assert.ok("user" in ok);
  assert.equal(ok.user.email, "cara@example.com");
  assert.equal(ok.user.passwordHash, undefined);
});
