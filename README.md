# Personal Agents Control Plane

Email-authenticated control plane for **one Cursor cloud agent per person**.

Each person gets:

- a standing Cursor Cloud Agent (follow-ups, not a shared global agent)
- a **personal GitHub repo** for skills they install
- private **memory** injected into their prompts
- an encrypted **credential vault** (secrets never go in chat prompts)
- hard isolation so person A cannot see person B’s jobs, memory, or secrets

People talk to their agent in the **in-app Chat**. Slack is optional and not required.

## Architecture

```
Web Chat (or optional Slack)  →  Control plane  →  Cursor Cloud Agents API
                                      │                 (user’s personal repo)
                                      ├─ memory pack
                                      ├─ enabled skills
                                      └─ job-scoped vault token
Cursor status/poll → settle → reply in Chat (and Slack thread if used)
```

Canonical user id: `email:{normalizedEmail}`.

## Local run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://127.0.0.1:43149](http://127.0.0.1:43149).

Create an account with email + password, then open **Chat**.

Without `CURSOR_API_KEY`, dispatch runs in **mock Cursor** mode so you can exercise chat → job → reply locally.

## Production setup

1. **Deploy** with `PUBLIC_URL`, strong `SESSION_SECRET` and `VAULT_MASTER_KEY`.
2. **Cursor** — set `CURSOR_API_KEY`. Optionally set `CURSOR_STATUS_WEBHOOK_SECRET` and point status webhooks at `{PUBLIC_URL}/api/cursor/status`. Poll backup: `GET /api/cursor/poll` with `CRON_SECRET`.
3. **GitHub** — `GITHUB_TOKEN` to auto-create private personal agent repos. Optional `GITHUB_ORG`. Optional `AGENT_TEMPLATE_REPO`.
4. **Operators** — optional `OPERATOR_EMAILS` (comma-separated) to restrict `/app/admin`.
5. **Store** — pick one durable backend (see [`docs/storage-options.md`](docs/storage-options.md)):
   - **Upstash Redis** — Vercel → Upstash integration → `PERSONAL_AGENTS_STORE=redis`, `PERSONAL_AGENTS_DISABLE_BLOB=1`, then `npm run migrate-store-to-redis`.
   - **Supabase** — reuse Pocketedge’s project or a new free project: run `scripts/supabase-store-migration.sql`, set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, `PERSONAL_AGENTS_STORE=supabase`, `PERSONAL_AGENTS_DISABLE_BLOB=1`, then `npm run migrate-store-to-supabase`.
   - Local dev uses `.data/store.json` when no cloud backend is configured.

### Optional Slack

Slack ingest still works if you configure a Slack app and env vars (`SLACK_*`). It is not required for login or chat.

## Skills catalog

Built-in skills ship under [`skills-catalog/`](skills-catalog/). Users install them from **Skills** in the UI; the control plane writes files into that user’s personal repo (when GitHub is configured) and tracks `enabledSkillIds`.

## Security notes

- Passwords are scrypt-hashed at rest; session cookies are signed JWTs.
- Vault secrets are AES-256-GCM encrypted per user.
- **Model-blind vault** (Hermes / OpenInstinct style): prompts contain only opaque handles. The job-scoped vault token is injected **only** into the `personal-vault` MCP server env (`mcpServers.env`), not the agent shell and not the prompt.
- **Browser autofill:** MCP tool `vault_fill` materializes the secret in-process and fills the page with Playwright; the tool result is `{filled_fields, origin, success}` only.
- **HTTP:** MCP tool `vault_http` / `POST /api/agent/vault/use` injects secrets server-side into outbound requests. Plaintext `/reveal` stays disabled.
- Optional `origin` on a vault item binds fill/HTTP to that host.
- Jobs, memory, vault, and threads are partitioned by owner.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server on port **43149** |
| `npm run build` | Production build |
| `npm test` | Isolation / vault unit tests |
