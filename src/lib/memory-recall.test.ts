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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("memory is ranked by importance and rejects credentials", async () => {
  const { buildMemoryPack, createMemory, listMemories, memoryRejection } = await import("@/lib/memory");
  const owner = "email:rank@example.com";
  await createMemory({ ownerUserId: owner, kind: "episode", title: "Small talk", content: "Weather.", importance: 1 });
  await createMemory({ ownerUserId: owner, kind: "goal", title: "Retire at 50", content: "Target 5 crore.", importance: 5 });
  await createMemory({ ownerUserId: owner, kind: "fact", title: "Broker", content: "Zerodha.", importance: 3 });

  assert.deepEqual(
    (await listMemories(owner)).map((m) => m.title),
    ["Retire at 50", "Broker", "Small talk"],
  );
  const pack = await buildMemoryPack(owner, 120);
  assert.match(pack.text, /Retire at 50/);
  assert.ok(pack.omitted > 0);

  assert.ok(memoryRejection("My password is hunter2"));
  assert.ok(memoryRejection("token sk_live_abcdefghijklmnopqrstu"));
  assert.equal(memoryRejection("Prefers amounts in lakh"), undefined);
});

test("every chat is remembered; recall stays inside the owner's thread", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createMemory, listMemories } = await import("@/lib/memory");
  const { createJob, patchJob } = await import("@/lib/jobs");
  const { settleJob } = await import("@/lib/settle");
  const { buildPersonalAgentPrompt } = await import("@/lib/prompt");

  const ra = await registerUserWithEmail({ email: "recall-a@example.com", password: "password-a-1" });
  const rb = await registerUserWithEmail({ email: "recall-b@example.com", password: "password-b-1" });
  assert.ok("user" in ra && "user" in rb);
  const a = ra.user;
  const b = rb.user;

  // The agent saved nothing itself, so the chat is logged as a low-importance episode.
  const first = await createJob({ ownerUserId: a.id, source: "web", prompt: "What is my portfolio worth?" });
  await settleJob(first.id, a.id, { message: "About 12.4 lakh." });
  let episodes = (await listMemories(a.id)).filter((m) => m.source === "auto");
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].importance, 1);
  assert.match(episodes[0].content, /portfolio worth[\s\S]*12\.4 lakh/);

  // When the agent wrote memory during the chat, no extra episode is added.
  await tick();
  const second = await createJob({ ownerUserId: a.id, source: "web", prompt: "I prefer lakh." });
  await createMemory({ ownerUserId: a.id, kind: "preference", title: "Amounts in lakh", content: "Use lakh.", importance: 4, source: "agent" });
  await patchJob(second.id, a.id, { memoryWrites: 1 });
  await settleJob(second.id, a.id, { message: "Noted." });
  episodes = (await listMemories(a.id)).filter((m) => m.source === "auto");
  assert.equal(episodes.length, 1);

  await tick();
  const slackJob = await createJob({
    ownerUserId: a.id,
    source: "slack",
    slackChannelId: "C1",
    slackThreadTs: "1.0",
    prompt: "Slack-only question",
  });
  await settleJob(slackJob.id, a.id, { message: "Slack-only answer" });

  await tick();
  const third = await createJob({ ownerUserId: a.id, source: "web", prompt: "And the top holding?" });
  const promptA = await buildPersonalAgentPrompt(a, third);
  assert.match(promptA, /User: What is my portfolio worth\?\nYou: About 12\.4 lakh\./);
  assert.ok(promptA.indexOf("What is my portfolio worth") < promptA.indexOf("User: I prefer lakh."));
  assert.match(promptA, /Amounts in lakh: Use lakh\./);
  assert.doesNotMatch(promptA, /User: Slack-only/);
  assert.match(promptA, /And the top holding\?\s*$/);

  const otherJob = await createJob({ ownerUserId: b.id, source: "web", prompt: "Hi" });
  const promptB = await buildPersonalAgentPrompt(b, otherJob);
  assert.doesNotMatch(promptB, /portfolio worth|12\.4 lakh|Amounts in lakh/);
  assert.match(promptB, /first message in this chat/);
});
