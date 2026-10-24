import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PERSONAL_AGENTS_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "pa-thread-"));
process.env.SESSION_SECRET = "test-session-secret";
process.env.VAULT_MASTER_KEY = "test-vault-master";
process.env.CURSOR_API_KEY = "";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.BLOB_STORE_ID = "";

test("each web thread gets its own mock Cursor agent id", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createWorkspace } = await import("@/lib/workspaces");
  const { createJob } = await import("@/lib/jobs");
  const { dispatchJob } = await import("@/lib/cursor");
  const { agentBindingForJob } = await import("@/lib/thread-agents");

  const reg = await registerUserWithEmail({ email: "threads@example.com", password: "password-threads-1" });
  assert.ok("user" in reg);
  const ws = await createWorkspace(reg.user, { name: "Thread Co" });
  assert.ok("workspace" in ws);
  const { getUser } = await import("@/lib/users");
  const owner = (await getUser(reg.user.id))!;

  const jobA = await createJob({ ownerUserId: owner.id, source: "api", webThreadId: "t-a", prompt: "Hello A" });
  await dispatchJob(owner, jobA);
  const jobB = await createJob({ ownerUserId: owner.id, source: "api", webThreadId: "t-b", prompt: "Hello B" });
  await dispatchJob(owner, jobB);

  const bindA = await agentBindingForJob(jobA, owner);
  const bindB = await agentBindingForJob(jobB, owner);
  assert.ok(bindA.agentId);
  assert.ok(bindB.agentId);
  assert.notEqual(bindA.agentId, bindB.agentId);
});
