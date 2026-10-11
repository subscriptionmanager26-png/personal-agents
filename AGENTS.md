# Personal Agents control plane

This repository is the **control plane** (Slack + management UI), not a shared research skill repo.

- Personal Cursor agents run against each user’s own GitHub repo (provisioned from `agent-template/` / `AGENT_TEMPLATE_REPO`).
- Skills live in `skills-catalog/` and are installed per user.
- Never share jobs, memory, or vault secrets across `slack:{teamId}:{userId}` tenants.
- Do not add a global `CURSOR_REUSE_AGENT` path.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
