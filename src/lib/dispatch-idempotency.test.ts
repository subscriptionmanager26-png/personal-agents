import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PERSONAL_AGENTS_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "pa-idem-"));
process.env.SESSION_SECRET = "test-session-secret";
process.env.VAULT_MASTER_KEY = "test-vault-master";
process.env.CURSOR_API_KEY = "";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.BLOB_STORE_ID = "";
process.env.PERSONAL_AGENTS_RELATIONAL = "";
process.env.PERSONAL_AGENTS_STORE = "file";
delete process.env.POCKETEDGE_SUPABASE_URL;
delete process.env.POCKETEDGE_SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

test("clientSendId finds the same job for retries", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createWorkspace } = await import("@/lib/workspaces");
  const { createJob, findJobByClientSendId } = await import("@/lib/jobs");
  const { getUser } = await import("@/lib/users");

  const reg = await registerUserWithEmail({ email: "idem@example.com", password: "password-idem-1" });
  assert.ok("user" in reg);
  await createWorkspace(reg.user, { name: "Idem Co" });
  const owner = (await getUser(reg.user.id))!;

  const first = await createJob({
    ownerUserId: owner.id,
    source: "api",
    webThreadId: "t_idem_1",
    prompt: "hello once",
    clientSendId: "send-abc-1",
  });
  const found = await findJobByClientSendId({
    ownerUserId: owner.id,
    source: "api",
    webThreadId: "t_idem_1",
    clientSendId: "send-abc-1",
  });
  const other = await findJobByClientSendId({
    ownerUserId: owner.id,
    source: "api",
    webThreadId: "t_idem_1",
    clientSendId: "send-other",
  });

  assert.equal(found?.id, first.id);
  assert.equal(other, undefined);
});

test("claimJobDispatch allows only one concurrent claim", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createWorkspace } = await import("@/lib/workspaces");
  const { createJob, claimJobDispatch } = await import("@/lib/jobs");
  const { getUser } = await import("@/lib/users");

  const reg = await registerUserWithEmail({ email: "claim@example.com", password: "password-claim-1" });
  assert.ok("user" in reg);
  await createWorkspace(reg.user, { name: "Claim Co" });
  const owner = (await getUser(reg.user.id))!;

  const job = await createJob({
    ownerUserId: owner.id,
    source: "api",
    webThreadId: "t_claim_1",
    prompt: "claim me",
  });

  const a = await claimJobDispatch(job.id, owner.id);
  const b = await claimJobDispatch(job.id, owner.id);
  assert.equal(a, "claimed");
  assert.equal(b, "busy");
});

test("same thread reuses one mock agent across two jobs", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createWorkspace } = await import("@/lib/workspaces");
  const { createJob } = await import("@/lib/jobs");
  const { dispatchJob } = await import("@/lib/cursor");
  const { agentBindingForJob } = await import("@/lib/thread-agents");
  const { getUser } = await import("@/lib/users");

  const reg = await registerUserWithEmail({ email: "reuse@example.com", password: "password-reuse-1" });
  assert.ok("user" in reg);
  await createWorkspace(reg.user, { name: "Reuse Co" });
  const owner = (await getUser(reg.user.id))!;

  const job1 = await createJob({
    ownerUserId: owner.id,
    source: "api",
    webThreadId: "t_reuse_1",
    prompt: "first",
  });
  await dispatchJob(owner, job1);
  const bind1 = await agentBindingForJob(job1, owner);

  const job2 = await createJob({
    ownerUserId: owner.id,
    source: "api",
    webThreadId: "t_reuse_1",
    prompt: "second",
  });
  await dispatchJob(owner, job2);
  const bind2 = await agentBindingForJob(job2, owner);

  assert.ok(bind1.agentId);
  assert.equal(bind1.agentId, bind2.agentId);
});
