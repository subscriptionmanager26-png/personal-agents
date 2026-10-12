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

test("memory blocks are stripped from replies and filtered", async () => {
  const { extractMemorySuggestions } = await import("@/lib/memory-suggestions");

  const plain = extractMemorySuggestions("Just an answer.");
  assert.equal(plain.text, "Just an answer.");
  assert.deepEqual(plain.suggestions, []);

  const message = [
    "Here is your summary.",
    "",
    "```memory",
    JSON.stringify([
      { kind: "preference", title: "Lakh", content: "Show values in lakh." },
      { kind: "weird", title: "Broker", content: "Uses Zerodha." },
      { kind: "fact", title: "Login", content: "Password is hunter2" },
      { kind: "fact", title: "Key", content: "Uses sk_live_abcdefghijklmnopqrstu" },
      { kind: "note", title: "", content: "missing title" },
    ]),
    "```",
  ].join("\n");
  const out = extractMemorySuggestions(message);
  assert.equal(out.text, "Here is your summary.");
  assert.deepEqual(
    out.suggestions.map((s) => [s.kind, s.title]),
    [
      ["preference", "Lakh"],
      ["note", "Broker"],
    ],
  );

  const lines = extractMemorySuggestions(
    'Ok.\n```memory\n{"title":"A","content":"one"}\nnot json\n{"title":"B","content":"two"}\n```',
  );
  assert.deepEqual(lines.suggestions.map((s) => s.title), ["A", "B"]);
});

test("suggestions need approval; recall stays inside the owner's thread", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { buildMemoryPack, listMemories, updateMemory } = await import("@/lib/memory");
  const { createJob, getJob } = await import("@/lib/jobs");
  const { settleJob } = await import("@/lib/settle");
  const { buildPersonalAgentPrompt } = await import("@/lib/prompt");

  const ra = await registerUserWithEmail({ email: "recall-a@example.com", password: "password-a-1" });
  const rb = await registerUserWithEmail({ email: "recall-b@example.com", password: "password-b-1" });
  assert.ok("user" in ra && "user" in rb);
  const a = ra.user;
  const b = rb.user;

  const first = await createJob({ ownerUserId: a.id, source: "web", prompt: "What is my portfolio worth?" });
  await settleJob(first.id, a.id, {
    message:
      'About 12.4 lakh.\n\n```memory\n[{"kind":"preference","title":"Show amounts in lakh","content":"Use lakh."}]\n```',
  });
  const settled = await getJob(first.id);
  assert.equal(settled?.reply?.message, "About 12.4 lakh.");
  assert.equal(settled?.suggestedMemoryIds?.length, 1);

  const suggested = (await listMemories(a.id)).filter((m) => m.status === "suggested");
  assert.equal(suggested.length, 1);
  assert.doesNotMatch(await buildMemoryPack(a.id), /Show amounts in lakh/);

  await updateMemory(a.id, suggested[0].id, { status: "active" });
  assert.match(await buildMemoryPack(a.id), /Show amounts in lakh/);

  // The same suggestion is not offered again once the user has it.
  await tick();
  const repeat = await createJob({ ownerUserId: a.id, source: "web", prompt: "Again?" });
  await settleJob(repeat.id, a.id, {
    message: 'Same.\n```memory\n[{"title":"Show amounts in lakh","content":"Use lakh."}]\n```',
  });
  assert.equal((await getJob(repeat.id))?.suggestedMemoryIds, undefined);

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
  const second = await createJob({ ownerUserId: a.id, source: "web", prompt: "And the top holding?" });
  const promptA = await buildPersonalAgentPrompt(a, second);
  assert.match(promptA, /User: What is my portfolio worth\?\nYou: About 12\.4 lakh\./);
  assert.ok(promptA.indexOf("What is my portfolio worth") < promptA.indexOf("User: Again?"));
  assert.doesNotMatch(promptA, /"title":"Show amounts in lakh"/);
  assert.doesNotMatch(promptA, /Slack-only/);
  assert.match(promptA, /And the top holding\?\s*$/);

  const otherJob = await createJob({ ownerUserId: b.id, source: "web", prompt: "Hi" });
  const promptB = await buildPersonalAgentPrompt(b, otherJob);
  assert.doesNotMatch(promptB, /portfolio worth|12\.4 lakh|Show amounts in lakh/);
  assert.match(promptB, /first message in this chat/);
});
