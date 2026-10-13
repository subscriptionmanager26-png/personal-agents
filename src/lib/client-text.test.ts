import assert from "node:assert/strict";
import test from "node:test";

import { clientError, clientStreamEvent, clientText, clientTrace } from "@/lib/client-text";

test("file paths become plain file names", () => {
  assert.equal(
    clientText("I saved a longer write-up in artifacts/cas-jit-review.md."),
    "I saved a longer write-up in cas-jit-review.md.",
  );
  assert.equal(clientText("See `/opt/cursor/artifacts/screens/01-login.png`"), "See `01-login.png`");
  assert.equal(clientText("Open [the report](artifacts/report.md) for details"), "Open **the report** for details");
  assert.equal(clientText("my-artifacts/x.md stays"), "my-artifacts/x.md stays");
  assert.equal(
    clientText("longer memos saved under `artifacts/` when you want them"),
    "longer memos saved in your Files when you want them",
  );
  assert.equal(clientText("I wrote it to the artifacts folder."), "I wrote it to your Files.");
  assert.equal(clientText("Check artifacts/ later"), "Check your Files later");
  assert.equal(clientText("Ancient artifacts are valuable"), "Ancient artifacts are valuable");
});

test("the agent platform is never named", () => {
  assert.equal(clientText("I'm a Cursor cloud agent."), "I'm an assistant.");
  assert.equal(clientText("Cursor can't reach that site."), "The assistant can't reach that site.");
  assert.equal(clientText("Run it at https://cursor.com/agents/bc-1 today"), "Run it at today");
  assert.equal(
    clientText("Agent bc-bab5770d-69ea-467a-adae-bbc33fccdca2 pushed cursor/fix-a1b2"),
    "Agent pushed",
  );
  assert.equal(clientText("Move the mouse cursor here"), "Move the mouse cursor here");
});

test("internal errors are replaced, plain ones are kept", () => {
  assert.match(clientError("Cursor create failed (HTTP 401): bad key"), /could not finish/);
  assert.match(clientError("Agent run ended with status ERROR"), /could not finish/);
  assert.equal(clientError("Your account is waiting for approval."), "Your account is waiting for approval.");
});

test("stream events and traces are filtered", () => {
  const block = clientStreamEvent({ type: "block", block: { kind: "card", title: "Saved in artifacts/a.md", body: "via Cursor" } });
  assert.deepEqual(block, { type: "block", block: { kind: "card", title: "Saved in a.md", body: "via the assistant", fields: undefined } });

  const tool = clientTrace({
    type: "tool",
    callId: "c1",
    name: "Shell",
    kind: "terminal",
    status: "running",
    title: "cat /opt/cursor/artifacts/x",
    terminal: { command: "cat /opt/cursor/artifacts/x" },
  });
  assert.equal(JSON.stringify(tool).includes("cursor"), false);
  assert.deepEqual(clientTrace({ type: "thinking", text: "secret plan" }), { type: "thinking", text: "" });
});
