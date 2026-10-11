#!/usr/bin/env node
/**
 * Model-blind personal vault MCP (Hermes / OpenInstinct style).
 *
 * - Job token lives ONLY in this process env (Cursor mcpServers.env).
 * - Tools never return plaintext secrets to the model.
 * - vault_fill materializes the secret in-process and injects via Playwright.
 */

import { createInterface } from "node:readline";

const PUBLIC_URL = (process.env.PA_PUBLIC_URL || "").replace(/\/$/, "");
const TOKEN = process.env.PA_VAULT_JOB_TOKEN || "";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function scrub(text, secret) {
  if (!secret || !text) return text || "";
  return String(text).split(secret).join("[REDACTED]");
}

async function api(pathname, init = {}) {
  if (!PUBLIC_URL) throw new Error("PA_PUBLIC_URL is not set");
  if (!TOKEN) throw new Error("PA_VAULT_JOB_TOKEN is not set");
  const res = await fetch(`${PUBLIC_URL}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function vaultList() {
  const data = await api("/api/agent/vault/handles");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ handles: data.handles || [] }),
      },
    ],
  };
}

async function vaultHttp(args) {
  const data = await api("/api/agent/vault/use", {
    method: "POST",
    body: JSON.stringify({
      handle: args.handle,
      label: args.label,
      action: "http",
      url: args.url,
      method: args.method || "GET",
      headers: args.headers,
      body: args.body,
      inject: args.inject || { header: "Authorization", scheme: "Bearer" },
    }),
  });
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

async function materialize(handle, label, pageOrigin) {
  return api("/api/agent/vault/materialize", {
    method: "POST",
    body: JSON.stringify({ handle, label, pageOrigin }),
  });
}

function buildFillScript(opts) {
  return `(() => {
    const username = ${JSON.stringify(opts.username || "")};
    const password = ${JSON.stringify(opts.password || "")};
    const userSel = ${JSON.stringify(opts.usernameSelector || "")};
    const passSel = ${JSON.stringify(opts.passwordSelector || "")};
    const submitSel = ${JSON.stringify(opts.submitSelector || "")};

    function pick(selectors, attrs) {
      for (const sel of selectors) {
        if (!sel) continue;
        const el = document.querySelector(sel);
        if (el) return el;
      }
      for (const attr of attrs) {
        const el = document.querySelector(attr);
        if (el) return el;
      }
      return null;
    }

    function fill(el, value) {
      if (!el || value == null || value === "") return false;
      el.focus();
      el.value = value;
      el.setAttribute("data-vault-secret", "true");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    let filled = 0;
    const userEl = pick(
      [userSel],
      [
        'input[type="email"]',
        'input[name*="user" i]',
        'input[name*="email" i]',
        'input[autocomplete="username"]',
        'input[type="text"]',
      ],
    );
    const passEl = pick(
      [passSel],
      [
        'input[type="password"]',
        'input[autocomplete="current-password"]',
        'input[name*="pass" i]',
      ],
    );

    if (username && fill(userEl, username)) filled += 1;
    if (password && fill(passEl, password)) filled += 1;

    if (submitSel) {
      const btn = document.querySelector(submitSel);
      if (btn) btn.click();
    }

    return {
      filled_fields: filled,
      origin: location.origin,
      success: filled > 0,
      url: location.href,
      password_value_length: passEl && passEl.value ? passEl.value.length : 0,
      username_filled: Boolean(userEl && userEl.value),
    };
  })()`;
}

async function vaultFill(args) {
  const url = args.url;
  if (!url) throw new Error("url is required");
  let pageOrigin;
  try {
    pageOrigin = new URL(url).origin;
  } catch {
    throw new Error("invalid url");
  }

  let secretPayload;
  try {
    secretPayload = await materialize(args.handle, args.label, pageOrigin);
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.body?.error || error.message,
            detail: error.body?.detail,
          }),
        },
      ],
    };
  }

  const password = secretPayload.secret;
  const username = args.username || secretPayload.username || "";

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "playwright_missing",
            detail:
              "Install Playwright in the cloud environment (see .cursor/environment.json).",
          }),
        },
      ],
    };
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

    const finalOrigin = new URL(page.url()).origin;
    if (secretPayload.origin) {
      const bound = new URL(secretPayload.origin).host;
      if (new URL(finalOrigin).host !== bound) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "origin_mismatch",
                detail: `Credential bound to ${bound}, landed on ${new URL(finalOrigin).host}`,
              }),
            },
          ],
        };
      }
    }

    const result = await page.evaluate(
      buildFillScript({
        username,
        password,
        usernameSelector: args.username_selector,
        passwordSelector: args.password_selector,
        submitSelector: args.submit_selector,
      }),
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: Boolean(result.success),
            filled_fields: result.filled_fields || 0,
            origin: result.origin,
            url: result.url,
            handle: secretPayload.handle,
            label: secretPayload.label,
            kind: "login",
            // lengths only — never values
            password_filled: (result.password_value_length || 0) > 0,
            username_filled: Boolean(result.username_filled),
          }),
        },
      ],
    };
  } catch (error) {
    const message = scrub(
      error instanceof Error ? error.message : String(error),
      password,
    );
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: false, error: message }),
        },
      ],
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

const TOOLS = [
  {
    name: "vault_list",
    description:
      "List opaque credential handles (metadata only). Secrets are never returned.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "vault_fill",
    description:
      "Model-blind browser autofill. Opens the URL, verifies origin, fills username/password via Playwright. Returns only {filled_fields, origin, success} — never the password.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string", description: "Opaque vault handle" },
        label: {
          type: "string",
          description: "Vault label (optional alternative to handle)",
        },
        url: { type: "string", description: "Page URL to open and fill" },
        username: { type: "string", description: "Override username (optional)" },
        username_selector: { type: "string" },
        password_selector: { type: "string" },
        submit_selector: {
          type: "string",
          description: "Optional submit button selector",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "vault_http",
    description:
      "Model-blind authenticated HTTP call. Control plane injects the secret server-side; response is scrubbed.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        label: { type: "string" },
        url: { type: "string" },
        method: { type: "string" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string" },
        inject: { type: "object" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  if (name === "vault_list") return vaultList();
  if (name === "vault_fill") return vaultFill(args || {});
  if (name === "vault_http") return vaultHttp(args || {});
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "personal-vault", version: "1.0.0" },
      },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments || {});
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error.message || String(error) }),
            },
          ],
        },
      };
    }
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const response = await handleMessage(msg);
    if (response) send(response);
  } catch (error) {
    if (msg?.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32000, message: String(error.message || error) },
      });
    }
  }
});

process.stdin.on("end", () => process.exit(0));
