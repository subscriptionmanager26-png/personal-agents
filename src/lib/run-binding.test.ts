import assert from "node:assert/strict";
import test from "node:test";

import { assignRunsToJobs, finalAssistantTextsByTurn } from "@/lib/run-binding";

test("assigns earliest matching run to each job; leaves ghost runs unclaimed", () => {
  // Real Nifty thread shape: 2 PA jobs, 3 Cursor runs (middle run is a re-dispatch ghost).
  const jobs = [
    { id: "job_e3f9", createdAt: "2026-10-26T18:48:46.742Z", cursorRunId: undefined as string | undefined },
    {
      id: "job_31fb",
      createdAt: "2026-10-27T06:23:41.245Z",
      cursorRunId: "run-2e9d8b5f-e8ef-4313-8426-7780efd75edc",
    },
  ];
  const runs = [
    { id: "run-2e9d8b5f-e8ef-4313-8426-7780efd75edc", createdAt: "2026-10-27T06:23:44.332Z" },
    { id: "run-fa5bebc7-3557-40e5-a073-77a97e476913", createdAt: "2026-10-26T18:50:17.541Z" },
    { id: "run-89097615-45fa-46a3-8179-373da7630571", createdAt: "2026-10-26T18:48:53.138Z" },
  ];

  const map = assignRunsToJobs(jobs, runs);
  assert.equal(map.get("job_e3f9"), "run-89097615-45fa-46a3-8179-373da7630571");
  assert.equal(map.has("job_31fb"), false, "already-bound job is not reassigned");
  assert.equal(
    [...map.values()].includes("run-fa5bebc7-3557-40e5-a073-77a97e476913"),
    false,
    "ghost re-dispatch run stays unclaimed",
  );
});

test("does not steal a run already claimed by another job", () => {
  const jobs = [
    { id: "a", createdAt: "2026-10-26T18:48:46.000Z", cursorRunId: "run-first" },
    { id: "b", createdAt: "2026-10-26T18:49:00.000Z", cursorRunId: undefined as string | undefined },
  ];
  const runs = [
    { id: "run-first", createdAt: "2026-10-26T18:48:50.000Z" },
    { id: "run-second", createdAt: "2026-10-26T18:49:05.000Z" },
  ];
  const map = assignRunsToJobs(jobs, runs);
  assert.equal(map.get("b"), "run-second");
});

test("finalAssistantTextsByTurn keeps last bubble per turn, not every step", () => {
  const finals = finalAssistantTextsByTurn([
    { id: "turn-0:step:1:assistant", type: "assistant_message", text: "Gathering…" },
    { id: "turn-0:step:20:assistant", type: "assistant_message", text: "Full answer A" },
    { id: "turn-1:step:1:assistant", type: "assistant_message", text: "Pulling…" },
    { id: "turn-1:step:9:assistant", type: "assistant_message", text: "Full answer B" },
    { id: "turn-2:user", type: "user_message", text: "ignore" },
  ]);
  assert.deepEqual(finals, ["Full answer A", "Full answer B"]);
});
