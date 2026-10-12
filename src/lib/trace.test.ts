import assert from "node:assert/strict";
import test from "node:test";

import { mockScript } from "@/lib/mock-trace";
import { normalizeToolCall, parseSse, toTraceEvent } from "@/lib/trace";

test("vault tool calls keep only allow-listed metadata", () => {
  const tool = normalizeToolCall({
    callId: "c1",
    name: "mcp",
    status: "completed",
    args: {
      server: "personal-vault",
      toolName: "vault_fill",
      arguments: { handle: "vault_1", url: "https://bank.example.com", password: "hunter2" },
      env: { PA_VAULT_JOB_TOKEN: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl" },
    },
    result: { filled_fields: 2, origin: "https://bank.example.com", success: true, debug: "hunter2" },
  });
  const wire = JSON.stringify(tool);
  assert.equal(tool.kind, "vault");
  assert.doesNotMatch(wire, /hunter2/);
  assert.doesNotMatch(wire, /eyJ/);
  assert.match(wire, /vault_1/);
  assert.match(wire, /filled_fields/);
});

test("non-vault tools redact token-like strings and extract terminal output", () => {
  const tool = normalizeToolCall({
    callId: "c2",
    name: "run_terminal_cmd",
    status: "completed",
    args: { command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' https://x" },
    result: { success: { output: "ok\n", exitCode: 0 } },
  });
  assert.equal(tool.kind, "terminal");
  assert.equal(tool.terminal?.output, "ok\n");
  assert.equal(tool.terminal?.exitCode, 0);
  assert.doesNotMatch(JSON.stringify(tool), /abcdefghijklmnopqrstuvwxyz123456/);
});

test("parseSse handles split chunks, ids and multi-line data", async () => {
  const chunks = [
    'event: status\ndata: {"status":"RUNNING"}\n\n',
    "id: 1-0\nevent: thinking\nda",
    'ta: {"text":"hi"}\n\n: heartbeat comment\n\nid: 2-0\nevent: done\ndata: {}\n\n',
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
  const events = [];
  for await (const e of parseSse(body)) events.push(e);
  assert.deepEqual(
    events.map((e) => [e.id, e.event]),
    [
      [undefined, "status"],
      ["1-0", "thinking"],
      ["2-0", "done"],
    ],
  );
  assert.deepEqual(toTraceEvent(events[1]), { type: "thinking", text: "hi" });
});

test("mock script never leaks the vault secret after normalization", () => {
  const wire = mockScript("job_test", "hello")
    .map((e) => JSON.stringify(toTraceEvent(e)))
    .join("\n");
  assert.doesNotMatch(wire, /this-should-never-reach-the-browser/);
  assert.doesNotMatch(wire, /eyJhbGci/);
});
