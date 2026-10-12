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
process.env.BLOB_READ_WRITE_TOKEN = "";
process.env.BLOB_STORE_ID = "";

async function signup(email: string, joinWorkspaceId?: string) {
  const { registerUserWithEmail } = await import("@/lib/users");
  const result = await registerUserWithEmail({ email, password: "password-123", joinWorkspaceId });
  assert.ok("user" in result);
  return result.user;
}

async function setup() {
  const { createWorkspace, upsertSkill } = await import("@/lib/workspaces");
  const { getUser } = await import("@/lib/users");

  const advisor = await signup("advisor@example.com");
  const created = await createWorkspace(advisor, { name: "Acme Wealth" });
  assert.ok("workspace" in created);
  const ws = created.workspace;
  const other = await signup("rival@example.com");
  const otherCreated = await createWorkspace(other, { name: "Rival Wealth" });
  assert.ok("workspace" in otherCreated);
  const otherWs = otherCreated.workspace;
  await upsertSkill(advisor.id, ws.id, {
    name: "Portfolio review",
    description: "Review holdings",
    content: "SECRET-PLAYBOOK step 1",
  });

  const alice = await signup("alice@example.com", ws.id);
  const bob = await signup("bob@example.com", ws.id);
  return {
    advisor: (await getUser(advisor.id))!,
    other: (await getUser(other.id))!,
    ws,
    otherWs,
    alice,
    bob,
  };
}

let fixture: Awaited<ReturnType<typeof setup>> | undefined;
async function world() {
  fixture ??= await setup();
  return fixture;
}

test("clients join pending and only their own owner can approve them", async () => {
  const { canUseAgent, getClientForOwner, listClients, setClientStatus, createWorkspace } = await import("@/lib/workspaces");
  const { getUser } = await import("@/lib/users");
  const { advisor, other, ws, alice, bob } = await world();

  assert.equal(alice.role, "client");
  assert.equal(alice.membershipStatus, "pending");
  assert.equal(alice.workspaceId, ws.id);
  assert.equal(canUseAgent(alice), false);
  assert.equal(canUseAgent(advisor), true);

  // Another workspace's owner cannot see or approve these clients.
  assert.equal(await setClientStatus(other.id, alice.id, "active"), false);
  assert.equal(await getClientForOwner(other.id, alice.id), undefined);
  assert.deepEqual(await listClients(other.id, ws.id), []);
  // Clients cannot approve each other.
  assert.equal(await setClientStatus(bob.id, alice.id, "active"), false);
  assert.equal(canUseAgent(await getUser(alice.id)), false);

  assert.equal(await setClientStatus(advisor.id, alice.id, "active"), true);
  assert.equal(canUseAgent(await getUser(alice.id)), true);
  assert.equal((await getClientForOwner(advisor.id, alice.id))?.passwordHash, undefined);
  assert.deepEqual(
    (await listClients(advisor.id, ws.id)).map((c) => c.email).sort(),
    ["alice@example.com", "bob@example.com"],
  );

  // A client cannot start a second workspace to escape approval.
  const escape = await createWorkspace((await getUser(bob.id))!, { name: "Bob Inc" });
  assert.ok("error" in escape);
});

test("pending clients cannot dispatch their agent", async () => {
  const { dispatchJob } = await import("@/lib/cursor");
  const { createJob, getJob } = await import("@/lib/jobs");
  const { getUser } = await import("@/lib/users");
  const { bob } = await world();

  const job = await createJob({ ownerUserId: bob.id, source: "web", prompt: "hi" });
  await dispatchJob((await getUser(bob.id))!, job);
  const after = await getJob(job.id);
  assert.equal(after?.status, "error");
  assert.match(after?.error ?? "", /waiting for approval/);
});

test("memory MCP is scoped to the token's client", async () => {
  const { createMemory, listMemories } = await import("@/lib/memory");
  const { createJob } = await import("@/lib/jobs");
  const { createMemoryToken } = await import("@/lib/run-token");
  const { handleMemoryRpc } = await import("@/lib/memory-mcp");
  const { setClientStatus } = await import("@/lib/workspaces");
  const { advisor, alice, bob } = await world();
  await setClientStatus(advisor.id, alice.id, "active");
  await setClientStatus(advisor.id, bob.id, "active");

  const bobNote = await createMemory({ ownerUserId: bob.id, kind: "fact", title: "Bob holds TCS", content: "200 shares" });
  const job = await createJob({ ownerUserId: alice.id, source: "web", prompt: "hello" });
  const token = await createMemoryToken({ ownerUserId: alice.id, jobId: job.id });
  const call = (name: string, args: Record<string, unknown>) =>
    handleMemoryRpc(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const payload = (res: Awaited<ReturnType<typeof call>>) =>
    JSON.parse((res.json as { result: { content: { text: string }[] } }).result.content[0].text);

  const saved = payload(await call("memory_save", { title: "Goal", content: "Retire at 50", kind: "goal", importance: 5 }));
  assert.equal(saved.saved.importance, 5);
  assert.ok(payload(await call("memory_save", { title: "Login", content: "password is hunter2" })).error);

  const search = payload(await call("memory_search", { query: "TCS" }));
  assert.deepEqual(search.memories, []);
  assert.ok(payload(await call("memory_update", { id: bobNote.id, content: "hacked" })).error);
  assert.ok(payload(await call("memory_forget", { id: bobNote.id })).error);
  assert.equal((await listMemories(bob.id))[0].content, "200 shares");
  assert.deepEqual((await listMemories(alice.id)).map((m) => m.title), ["Goal"]);

  // Token for one client's job cannot be replayed for another client.
  const bobJob = await createJob({ ownerUserId: bob.id, source: "web", prompt: "hi" });
  const forged = await createMemoryToken({ ownerUserId: alice.id, jobId: bobJob.id });
  assert.equal((await handleMemoryRpc(forged, { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
  assert.equal((await handleMemoryRpc("not-a-token", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);

  // Suspending a client cuts off its agent's memory access.
  await setClientStatus(advisor.id, alice.id, "suspended");
  assert.equal((await call("memory_search", {})).status, 401);
  await setClientStatus(advisor.id, alice.id, "active");
});

test("prompt carries the owner's skills and confidentiality, and only this client's data", async () => {
  const { buildPersonalAgentPrompt } = await import("@/lib/prompt");
  const { createMemory } = await import("@/lib/memory");
  const { createJob } = await import("@/lib/jobs");
  const { getUser } = await import("@/lib/users");
  const { alice, bob } = await world();

  await createMemory({ ownerUserId: bob.id, kind: "fact", title: "Bob net worth", content: "9 crore" });
  const job = await createJob({ ownerUserId: alice.id, source: "web", prompt: "How many clients does Acme have?" });
  const prompt = await buildPersonalAgentPrompt((await getUser(alice.id))!, job);

  assert.match(prompt, /a client of Acme Wealth/);
  assert.match(prompt, /## Confidentiality/);
  assert.match(prompt, /SECRET-PLAYBOOK step 1/);
  assert.doesNotMatch(prompt, /Bob|9 crore|TCS|bob@example\.com|Rival Wealth/);
});
