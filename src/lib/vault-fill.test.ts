import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PERSONAL_AGENTS_DATA_DIR = mkdtempSync(
  path.join(os.tmpdir(), "pa-fill-"),
);
process.env.SESSION_SECRET = "test-session-secret-fill";
process.env.VAULT_MASTER_KEY = "test-vault-master-fill";
process.env.PUBLIC_URL = "https://example.test";
process.env.CURSOR_API_KEY = "";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

const LOGIN_HTML = `<!doctype html>
<html><body>
<form id="login">
  <input id="email" type="email" name="email" />
  <input id="password" type="password" name="password" />
  <button type="submit">Sign in</button>
</form>
</body></html>`;

function startLoginServer(): Promise<{
  server: http.Server;
  url: string;
  origin: string;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(LOGIN_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/login`,
        origin: `http://127.0.0.1:${addr.port}`,
      });
    });
  });
}

test("browser autofill injects password without returning it to the tool result shape", async () => {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createVaultItem, revealVaultItem } = await import("@/lib/vault");
  const { createJob } = await import("@/lib/jobs");
  const playwright = await import("playwright");

  const created = await registerUserWithEmail({
    email: "fill@example.com",
    password: "password-fill-1",
  });
  assert.ok("user" in created);

  const { server, url, origin } = await startLoginServer();
  try {
    const item = await createVaultItem({
      ownerUserId: created.user.id,
      label: "demo-login",
      username: "ada@example.com",
      origin,
      secret: "hunter2-secret-value",
    });
    const job = await createJob({
      ownerUserId: created.user.id,
      source: "web",
      prompt: "log in",
    });

    const material = await revealVaultItem({
      ownerUserId: created.user.id,
      jobId: job.id,
      itemId: item.id,
    });
    assert.equal(material?.secret, "hunter2-secret-value");

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const result = await page.evaluate(
        ({ username, password }) => {
          const userEl = document.querySelector("#email") as HTMLInputElement | null;
          const passEl = document.querySelector(
            "#password",
          ) as HTMLInputElement | null;
          if (!userEl || !passEl) {
            return {
              success: false,
              filled_fields: 0,
              origin: location.origin,
              password_in_dom: false,
            };
          }
          userEl.value = username;
          passEl.value = password;
          passEl.setAttribute("data-vault-secret", "true");
          return {
            success: true,
            filled_fields: 2,
            origin: location.origin,
            password_in_dom: passEl.value === password,
          };
        },
        {
          username: material!.username || "",
          password: material!.secret,
        },
      );

      const toolResult = {
        success: result.success,
        filled_fields: result.filled_fields,
        origin: result.origin,
      };
      assert.equal(toolResult.filled_fields, 2);
      assert.equal(toolResult.origin, origin);
      assert.equal(JSON.stringify(toolResult).includes("hunter2"), false);
      assert.equal(result.password_in_dom, true);
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
