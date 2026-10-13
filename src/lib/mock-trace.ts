import type { RawSseEvent } from "@/lib/trace";

/** Local-only scripted run used when CURSOR_API_KEY is unset. */
export const MOCK_RUN_MS = 12_500;

export function mockRunId(jobId: string) {
  return `mock-run-${jobId}`;
}

export function isMockRunId(runId?: string) {
  return !!runId?.startsWith("mock-run-");
}

export function mockReplyText(prompt: string) {
  return [
    `Done. I logged into the demo broker portal with your saved credential, pulled the holdings page, and wrote a short report.`,
    ``,
    `- Portfolio value: ₹12.4L across 9 holdings`,
    `- Top position: NIFTYBEES (18%)`,
    `- 2 holdings are down more than 10% this month`,
    ``,
    `The full report is report.md in your Files, with screenshots of each step.`,
    ``,
    `(Demo mode: this reply is simulated. You asked: "${prompt.slice(0, 120)}")`,
  ].join("\n");
}

type Step = { delayMs: number; event: string; data: unknown };

function tool(
  callId: string,
  name: string,
  args: unknown,
  result: unknown,
  runMs: number,
): Step[] {
  return [
    { delayMs: 350, event: "tool_call", data: { callId, name, status: "running", args } },
    { delayMs: runMs, event: "tool_call", data: { callId, name, status: "completed", args, result } },
  ];
}

function chunks(text: string, size = 18) {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export function mockScript(jobId: string, prompt: string): RawSseEvent[] & { delays: number[] } {
  const runId = mockRunId(jobId);
  const thinking =
    "The user wants their holdings summarized. I should read the skill instructions first, then use the vault to log in without ever seeing the password. I'll capture screenshots at each step so they can verify what I did, then write the report to artifacts/.";
  const reply = mockReplyText(prompt);

  const steps: Step[] = [
    { delayMs: 0, event: "status", data: { runId, status: "RUNNING" } },
    ...chunks(thinking, 24).map((text) => ({ delayMs: 90, event: "thinking", data: { text } })),
    ...tool("call-1", "read_file", { path: ".cursor/skills/financial-analysis/SKILL.md" }, {
      success: { content: "# Financial analysis skill\n...", totalLines: 42 },
    }, 500),
    ...tool("call-2", "run_terminal_cmd", { command: "mkdir -p artifacts/screens && ls artifacts" }, {
      success: { output: "screens\n", exitCode: 0 },
    }, 700),
    ...tool(
      "call-3",
      "mcp",
      {
        server: "personal-vault",
        toolName: "vault_fill",
        arguments: {
          handle: "vault_demo_broker",
          url: "https://demo-broker.example.com/login",
          password: "this-should-never-reach-the-browser",
        },
        env: { PA_VAULT_JOB_TOKEN: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.c2lnbmF0dXJlLXZhbHVl" },
      },
      { filled_fields: 2, origin: "https://demo-broker.example.com", success: true },
      1400,
    ),
    ...tool("call-4", "computer_use", { action: "screenshot", url: "https://demo-broker.example.com/login", save_to: "artifacts/screens/01-login.svg" }, {
      success: { saved: "artifacts/screens/01-login.svg" },
    }, 900),
    ...tool("call-5", "computer_use", { action: "click", url: "https://demo-broker.example.com/holdings", target: "Holdings tab" }, {
      success: { saved: "artifacts/screens/02-holdings.svg" },
    }, 1300),
    ...tool(
      "call-6",
      "run_terminal_cmd",
      { command: "python scripts/summarize_holdings.py artifacts/holdings.csv" },
      {
        success: {
          output:
            "Loaded 9 holdings\nTotal value: 12,41,880 INR\nTop weight: NIFTYBEES 18.2%\nDown >10% (1M): 2\nWrote artifacts/report.md\n",
          exitCode: 0,
        },
      },
      1600,
    ),
    ...tool("call-7", "write", { path: "artifacts/report.md" }, { success: { bytesWritten: 2140 } }, 400),
    ...chunks(reply).map((text) => ({ delayMs: 45, event: "assistant", data: { text } })),
    { delayMs: 200, event: "result", data: { runId, status: "FINISHED", text: reply, durationMs: 14_200 } },
    { delayMs: 50, event: "done", data: {} },
  ];

  const events = steps.map((s, i) => ({
    id: i === 0 ? undefined : `mock-${i}`,
    event: s.event,
    data: JSON.stringify(s.data),
  })) as RawSseEvent[] & { delays: number[] };
  events.delays = steps.map((s) => s.delayMs);
  return events;
}

export const MOCK_ARTIFACTS = [
  { path: "artifacts/screens/01-login.svg", sizeBytes: 1830 },
  { path: "artifacts/screens/02-holdings.svg", sizeBytes: 2410 },
  { path: "artifacts/report.md", sizeBytes: 2140 },
];

function screen(title: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
<rect width="1280" height="800" fill="#f4f4f5"/>
<rect width="1280" height="44" fill="#27272a"/>
<circle cx="24" cy="22" r="7" fill="#ef4444"/><circle cx="46" cy="22" r="7" fill="#f59e0b"/><circle cx="68" cy="22" r="7" fill="#22c55e"/>
<rect x="100" y="10" width="760" height="24" rx="12" fill="#3f3f46"/>
<text x="118" y="27" font-family="ui-monospace,monospace" font-size="14" fill="#d4d4d8">${title}</text>
${body}
</svg>`;
}

export function mockArtifactContent(path: string): { body: string; type: string } | undefined {
  if (path === "artifacts/screens/01-login.svg") {
    return {
      type: "image/svg+xml",
      body: screen(
        "https://demo-broker.example.com/login",
        `<rect x="440" y="180" width="400" height="380" rx="16" fill="#fff" stroke="#e4e4e7"/>
<text x="640" y="240" text-anchor="middle" font-family="system-ui" font-size="26" font-weight="600" fill="#18181b">Demo Broker</text>
<text x="480" y="300" font-family="system-ui" font-size="14" fill="#52525b">Client ID</text>
<rect x="480" y="310" width="320" height="40" rx="8" fill="#fafafa" stroke="#d4d4d8"/>
<text x="494" y="336" font-family="system-ui" font-size="15" fill="#18181b">KA-209317</text>
<text x="480" y="380" font-family="system-ui" font-size="14" fill="#52525b">Password</text>
<rect x="480" y="390" width="320" height="40" rx="8" fill="#fafafa" stroke="#d4d4d8"/>
<text x="494" y="416" font-family="system-ui" font-size="18" fill="#18181b">••••••••••••</text>
<rect x="480" y="460" width="320" height="44" rx="8" fill="#18181b"/>
<text x="640" y="488" text-anchor="middle" font-family="system-ui" font-size="16" fill="#fff">Sign in</text>
<text x="640" y="540" text-anchor="middle" font-family="system-ui" font-size="12" fill="#16a34a">Filled by vault_fill · origin verified</text>`,
      ),
    };
  }
  if (path === "artifacts/screens/02-holdings.svg") {
    const rows = [
      ["NIFTYBEES", "2,26,020", "18.2%", "+1.2%"],
      ["HDFCBANK", "1,88,400", "15.2%", "-2.4%"],
      ["INFY", "1,42,310", "11.5%", "-11.8%"],
      ["TATAMOTORS", "1,20,900", "9.7%", "-13.1%"],
      ["ITC", "98,550", "7.9%", "+3.6%"],
    ];
    const table = rows
      .map(
        (r, i) =>
          `<text x="140" y="${300 + i * 56}" font-family="system-ui" font-size="17" fill="#18181b">${r[0]}</text>
<text x="620" y="${300 + i * 56}" font-family="ui-monospace,monospace" font-size="17" fill="#18181b">${r[1]}</text>
<text x="860" y="${300 + i * 56}" font-family="ui-monospace,monospace" font-size="17" fill="#52525b">${r[2]}</text>
<text x="1040" y="${300 + i * 56}" font-family="ui-monospace,monospace" font-size="17" fill="${r[3].startsWith("-") ? "#dc2626" : "#16a34a"}">${r[3]}</text>`,
      )
      .join("\n");
    return {
      type: "image/svg+xml",
      body: screen(
        "https://demo-broker.example.com/holdings",
        `<text x="120" y="120" font-family="system-ui" font-size="30" font-weight="600" fill="#18181b">Holdings</text>
<text x="120" y="160" font-family="system-ui" font-size="16" fill="#52525b">Total value ₹12,41,880 · 9 holdings</text>
<rect x="110" y="210" width="1060" height="320" rx="12" fill="#fff" stroke="#e4e4e7"/>
<text x="140" y="250" font-family="system-ui" font-size="13" fill="#71717a">SYMBOL</text>
<text x="620" y="250" font-family="system-ui" font-size="13" fill="#71717a">VALUE (₹)</text>
<text x="860" y="250" font-family="system-ui" font-size="13" fill="#71717a">WEIGHT</text>
<text x="1040" y="250" font-family="system-ui" font-size="13" fill="#71717a">1M</text>
${table}`,
      ),
    };
  }
  if (path === "artifacts/report.md") {
    return {
      type: "text/markdown; charset=utf-8",
      body: `# Holdings summary\n\nTotal value: ₹12,41,880 across 9 holdings.\n\n| Symbol | Weight | 1M |\n| --- | --- | --- |\n| NIFTYBEES | 18.2% | +1.2% |\n| HDFCBANK | 15.2% | -2.4% |\n| INFY | 11.5% | -11.8% |\n| TATAMOTORS | 9.7% | -13.1% |\n| ITC | 7.9% | +3.6% |\n\n## Watch list\n\n- INFY and TATAMOTORS are down more than 10% this month.\n`,
    };
  }
  return undefined;
}
