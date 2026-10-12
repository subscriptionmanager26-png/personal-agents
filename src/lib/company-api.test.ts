import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PERSONAL_AGENTS_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "pa-company-test-"));
process.env.SESSION_SECRET = "test-session-secret";
process.env.VAULT_MASTER_KEY = "test-vault-master";
process.env.CURSOR_API_KEY = "";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";
process.env.BLOB_READ_WRITE_TOKEN = "";
process.env.BLOB_STORE_ID = "";

async function owner(email: string, name: string) {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createWorkspace } = await import("@/lib/workspaces");
  const reg = await registerUserWithEmail({ email, password: "password-123" });
  assert.ok("user" in reg);
  const created = await createWorkspace(reg.user, { name });
  assert.ok("workspace" in created);
  return { user: reg.user, workspace: created.workspace };
}

async function setup() {
  const acme = await owner("ops@acme.example", "Acme Money");
  const rival = await owner("ops@rival.example", "Rival Money");
  return { acme, rival };
}

let fixture: Awaited<ReturnType<typeof setup>> | undefined;
const world = async () => (fixture ??= await setup());

async function fresh(workspaceId: string) {
  const { getWorkspace } = await import("@/lib/workspaces");
  return (await getWorkspace(workspaceId))!;
}

test("API keys resolve only their own workspace and are useless once revoked", async () => {
  const { createApiKey, revokeApiKey, authenticateApiKey } = await import("@/lib/company");
  const { getStore } = await import("@/lib/store");
  const { acme, rival } = await world();

  const created = await createApiKey(acme.user.id, acme.workspace.id, "backend");
  assert.ok(created);
  assert.match(created.key, /^pa_[a-f0-9]{12}_/);
  const stored = JSON.stringify(await getStore());
  assert.ok(!stored.includes(created.key.split("_")[2]), "the secret part is never stored");

  assert.equal((await authenticateApiKey(`Bearer ${created.key}`))?.id, acme.workspace.id);
  assert.equal(await authenticateApiKey(created.key), undefined, "Bearer prefix required");
  const tampered = created.key.slice(0, -2) + (created.key.endsWith("AA") ? "BB" : "AA");
  assert.equal(await authenticateApiKey(`Bearer ${tampered}`), undefined);
  assert.equal(await authenticateApiKey(null), undefined);

  assert.equal(await createApiKey(rival.user.id, acme.workspace.id, "steal"), undefined, "cannot mint keys for another workspace");
  assert.equal(await revokeApiKey(rival.user.id, acme.workspace.id, created.record.id), false);

  assert.equal(await revokeApiKey(acme.user.id, acme.workspace.id, created.record.id), true);
  assert.equal(await authenticateApiKey(`Bearer ${created.key}`), undefined);
});

test("API users are idempotent, scoped to the company and can be disabled", async () => {
  const { upsertApiUser, getApiUser, deactivateApiUser, apiUserId } = await import("@/lib/company");
  const { canUseAgent } = await import("@/lib/workspaces");
  const { acme, rival } = await world();

  const first = await upsertApiUser(acme.workspace, "cust_42", { name: "Priya" });
  assert.ok(first?.created);
  assert.equal(first.user.role, "client");
  assert.equal(first.user.membershipStatus, "active");
  assert.ok(canUseAgent(first.user));

  const again = await upsertApiUser(acme.workspace, "cust_42", {});
  assert.equal(again?.created, false);
  assert.equal(again?.user.id, first.user.id);
  assert.equal(again?.user.displayName, "Priya", "missing fields keep their old values");

  assert.equal(await upsertApiUser(acme.workspace, "bad id with spaces", {}), undefined);
  assert.equal(await getApiUser(rival.workspace, "cust_42"), undefined, "same external id, other company");
  const rivalUser = await upsertApiUser(rival.workspace, "cust_42", {});
  assert.ok(rivalUser?.created);
  assert.notEqual(rivalUser.user.id, first.user.id);
  assert.equal(first.user.id, apiUserId(acme.workspace.id, "cust_42"));

  assert.equal(await deactivateApiUser(rival.workspace, "cust_404"), false);
  assert.equal(await deactivateApiUser(acme.workspace, "cust_42"), true);
  assert.equal(canUseAgent(await getApiUser(acme.workspace, "cust_42")), false);
  assert.ok(canUseAgent(await getApiUser(rival.workspace, "cust_42")), "the other company's user is untouched");
  await upsertApiUser(acme.workspace, "cust_42", {});
  assert.ok(canUseAgent(await getApiUser(acme.workspace, "cust_42")), "upserting re-enables");
});

test("company user tokens are bound to one workspace and one server", async () => {
  const { addCompanyServer, ensureSigningSecret, createCompanyUserToken, verifyCompanyUserToken, upsertApiUser, companyServersForUser } =
    await import("@/lib/company");
  const { verifyMockCaller } = await import("@/lib/mock-company");
  const { acme, rival } = await world();

  assert.ok("error" in (await addCompanyServer(acme.user.id, acme.workspace.id, { name: "personal-agent", url: "https://x.example/mcp" })));
  assert.ok("error" in (await addCompanyServer(acme.user.id, acme.workspace.id, { name: "z", url: "https://u:p@x.example/mcp" })));
  assert.ok("server" in (await addCompanyServer(acme.user.id, acme.workspace.id, { name: "zerodha", url: "http://localhost:3000/api/mock/zerodha" })));
  assert.ok("server" in (await addCompanyServer(acme.user.id, acme.workspace.id, { name: "backtest", url: "http://localhost:3000/api/mock/backtest" })));
  assert.ok("error" in (await addCompanyServer(rival.user.id, acme.workspace.id, { name: "evil", url: "https://evil.example/mcp" })));

  const user = (await upsertApiUser(acme.workspace, "cust_7", {}))!.user;
  assert.deepEqual(await companyServersForUser(await fresh(acme.workspace.id), user), [], "no secret, no tokens");

  const secret = await ensureSigningSecret(acme.user.id, acme.workspace.id);
  assert.ok(secret);
  assert.equal(await ensureSigningSecret(acme.user.id, acme.workspace.id), secret, "stable until rotated");
  assert.equal(await ensureSigningSecret(rival.user.id, acme.workspace.id), undefined);

  const ws = await fresh(acme.workspace.id);
  assert.ok(!JSON.stringify(ws).includes(secret), "stored encrypted");
  const servers = await companyServersForUser(ws, user);
  assert.deepEqual(servers.map((s) => s.name), ["zerodha", "backtest"]);

  const token = await createCompanyUserToken(ws, user, "zerodha");
  assert.deepEqual(await verifyCompanyUserToken(token, secret, "zerodha"), { userId: "cust_7", workspace: ws.slug });
  await assert.rejects(verifyCompanyUserToken(token, secret, "backtest"));
  await assert.rejects(verifyCompanyUserToken(token, "another-secret", "zerodha"));

  assert.equal((await verifyMockCaller(token, "/api/mock/zerodha"))?.userId, "cust_7");
  assert.equal(await verifyMockCaller(token, "/api/mock/backtest"), undefined, "zerodha token cannot call backtest");
  assert.equal(await verifyMockCaller("garbage", "/api/mock/zerodha"), undefined);

  await ensureSigningSecret(acme.user.id, acme.workspace.id, true);
  assert.equal(await verifyMockCaller(token, "/api/mock/zerodha"), undefined, "rotation invalidates old tokens");
});

test("order proposals validate strictly and settle exactly once", async () => {
  const { validateOrder, proposeOrder, recordOrderOutcome, getOrder } = await import("@/lib/orders");
  const { createJob, getJob } = await import("@/lib/jobs");
  const { upsertApiUser } = await import("@/lib/company");
  const { acme } = await world();

  assert.ok("error" in validateOrder({ symbol: "INFY", side: "BUY", quantity: "10" }));
  assert.ok("error" in validateOrder({ symbol: "INFY", side: "BUY", quantity: 2.5 }));
  assert.ok("error" in validateOrder({ symbol: "INFY", side: "HOLD", quantity: 1 }));
  assert.ok("error" in validateOrder({ symbol: "INFY", side: "BUY", quantity: 1, order_type: "LIMIT" }));
  assert.ok("error" in validateOrder({ symbol: "INFY; DROP", side: "BUY", quantity: 1 }));
  const ok = validateOrder({ symbol: "infy", side: "BUY", quantity: 10, order_type: "LIMIT", price: 1522.456 });
  assert.ok("order" in ok);
  assert.deepEqual(ok.order, { exchange: "NSE", symbol: "INFY", side: "BUY", quantity: 10, orderType: "LIMIT", price: 1522.46, product: "CNC" });

  const user = (await upsertApiUser(acme.workspace, "cust_orders", {}))!.user;
  const other = (await upsertApiUser(acme.workspace, "cust_other", {}))!.user;
  const job = await createJob({ ownerUserId: user.id, source: "api", prompt: "buy infy" });
  const proposal = await proposeOrder({ ownerUserId: user.id, jobId: job.id, order: ok.order, rationale: "Fits the plan" });

  const action = (await getJob(job.id))!.stream!.find((e) => e.type === "action_required");
  assert.ok(action && action.type === "action_required" && action.action.kind === "order_confirmation");
  assert.equal(action.action.orderId, proposal.id);

  assert.equal(await getOrder(other.id, proposal.id), undefined);
  const stolen = await recordOrderOutcome(other.id, proposal.id, { status: "executed" });
  assert.ok("error" in stolen && stolen.code === 404);
  const invalid = await recordOrderOutcome(user.id, proposal.id, { status: "proposed" });
  assert.ok("error" in invalid && invalid.code === 400);

  const done = await recordOrderOutcome(user.id, proposal.id, { status: "executed", brokerOrderId: "240101000001" });
  assert.ok("order" in done && done.order.status === "executed");
  const twice = await recordOrderOutcome(user.id, proposal.id, { status: "rejected" });
  assert.ok("error" in twice && twice.code === 409);
});

test("the event stream follows the job lifecycle and the agent's UI tools", async () => {
  const { createJob, patchJob, getJob } = await import("@/lib/jobs");
  const { callAgentTool } = await import("@/lib/agent-mcp");
  const { messageView } = await import("@/lib/agent-api");
  const { upsertApiUser } = await import("@/lib/company");
  const { acme } = await world();

  const user = (await upsertApiUser(acme.workspace, "cust_stream", {}))!.user;
  const job = await createJob({ ownerUserId: user.id, source: "api", prompt: "review my portfolio" });
  const caller = { ownerUserId: user.id, jobId: job.id };
  const call = (name: string, args: Record<string, unknown>) => callAgentTool(caller, name, args);

  await patchJob(job.id, user.id, { status: "dispatched" });
  assert.equal((await call("update_status", { label: "Reading holdings" }))?.isError, undefined);
  assert.equal((await call("show_table", { columns: [], rows: [] }))?.isError, true);
  assert.equal(
    (await call("show_table", {
      title: "Holdings",
      columns: [{ key: "symbol", label: "Symbol" }, { key: "value", label: "Value", format: "currency" }],
      rows: [{ symbol: "INFY", value: 15220 }],
    }))?.isError,
    undefined,
  );
  assert.equal((await call("show_chart", { chartType: "pie", xKey: "x", series: [], data: [] }))?.isError, true);
  assert.equal((await call("request_login", { service: "Zerodha", url: "javascript:alert(1)" }))?.isError, true);
  assert.equal((await call("request_login", { service: "Zerodha", url: "https://kite.zerodha.com/connect" }))?.isError, undefined);
  assert.equal((await call("propose_order", { symbol: "INFY", side: "BUY", quantity: 5 }))?.isError, true, "rationale required");

  await patchJob(job.id, user.id, { status: "replied", reply: { message: "All good.", receivedAt: new Date().toISOString() } });
  assert.equal((await call("show_card", { title: "Late" }))?.isError, true, "stream is closed after done");

  const final = (await getJob(job.id))!;
  const types = final.stream!.map((e) => e.type);
  assert.deepEqual(types, ["status", "status", "status", "block", "action_required", "block", "done"]);
  assert.deepEqual(final.stream!.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7]);

  const view = messageView(final);
  assert.equal(view.status, "completed");
  assert.deepEqual(view.blocks.map((b) => b.kind), ["table", "markdown"]);
  assert.equal(view.actions[0]?.kind, "connection_login");

  const late = await call("propose_order", { symbol: "INFY", side: "BUY", quantity: 5, rationale: "x" });
  assert.equal(late?.isError, true, "no proposals after the message finished");

  const failing = await createJob({ ownerUserId: user.id, source: "api", prompt: "x" });
  await patchJob(failing.id, user.id, { status: "error", error: "boom" });
  await patchJob(failing.id, user.id, { status: "replied", reply: { message: "late", receivedAt: new Date().toISOString() } });
  const failed = (await getJob(failing.id))!;
  assert.deepEqual(failed.stream!.map((e) => e.type), ["status", "error"], "nothing after a terminal event");
});
