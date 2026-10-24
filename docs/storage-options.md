# Control-plane storage (free & low-cost options)

Personal Agents persists two things:

1. **JSON store** — users, API keys, **thread → Cursor agent id**, jobs (thin index + UI stream), vault metadata (~hundreds of KB today; one Cursor agent per chat thread).
2. **File bytes** — uploads and extracted text (can be larger).

Vercel **Blob** is convenient but easy to hit **quota / billing suspension**; the app should not depend on it in production.

## Recommended (already in code)

| Backend | Free tier (typical) | Fits Vercel | Status |
|--------|---------------------|-------------|--------|
| **Upstash Redis** | ~10k cmds/day, ~256MB; Vercel integration | Yes | **Built in** — set `KV_REST_*` or `UPSTASH_*`, `PERSONAL_AGENTS_STORE=redis`, `PERSONAL_AGENTS_DISABLE_BLOB=1` |
| **Supabase Postgres** | 500MB DB, 1GB file storage; pauses if idle on free | Yes (HTTP) | **Built in** — `PERSONAL_AGENTS_STORE=supabase` + service role |
| **Local `.data/`** | Unlimited on your machine | Dev only | Default when nothing else configured |

Migrate: `npm run migrate-store-to-redis` or `npm run migrate-store-to-supabase`.

## Other free options (not wired yet)

| Option | Free tier | Pros | Cons |
|--------|-----------|------|------|
| **Neon Postgres** | 0.5GB, serverless | Vercel marketplace, SQL | Copy `store-supabase.ts` pattern with `@neondatabase/serverless` |
| **Turso (libSQL)** | 5GB, 500M rows read/mo | Edge SQLite | New driver + schema work |
| **Cloudflare R2** | 10GB storage, no egress fee | Cheap objects | Not on Vercel; needs Worker or external fetch |
| **Cloudflare KV** | 100k reads/day free | Simple KV | 25MB value limit — OK for store today, tight if jobs grow |
| **MongoDB Atlas M0** | 512MB | Document-native | Extra cluster to operate |
| **Deta Base / Space** | Small free caps | Key-value | Less common on Vercel tutorials |
| **GitHub private repo** | Free | Versioned JSON | Rate limits, not a database; awkward concurrency |
| **Fly.io volume + SQLite** | Small VM free allowance | Real disk | You run the control plane off Vercel |
| **Self-host PA** | Your disk | `.data/` forever | Not serverless; you operate uptime |

### Zero-cost paths that work *today* without Blob

1. **Supabase on the same project as Pocketedge** — one SQL migration, service role only on `personal-agents` Vercel env (no extra Supabase bill if you already use it).
2. **Upstash Redis** — separate free database on the PA Vercel project only (~500KB store is tiny).
3. **Restore from local backup** — if you have `.data/store.json` or a one-time Blob export, migrate to Redis or Supabase; re-run `seed:pocketedge` only if keys are lost.
4. **Dev-only** — run `npm run dev` locally with `.data/`; production still needs Redis or Supabase.

## What we do *not* use for production on Vercel

- **Filesystem** — serverless functions have no durable disk.
- **Vercel Blob** — optional only if Redis/Supabase unavailable; disable with `PERSONAL_AGENTS_DISABLE_BLOB=1`.

## Suggested production setup (Pocketedge)

1. **Same Supabase project as Pocketedge auth** (or a dedicated project): `PERSONAL_AGENTS_STORE=supabase`, run `scripts/supabase-store-migration.sql` once.
2. **Or** Upstash Redis on the `personal-agents` Vercel project only.
3. **`PERSONAL_AGENTS_DISABLE_BLOB=1`** on production so Blob suspension never mimics “invalid API key” again.

Priority when `PERSONAL_AGENTS_STORE` is unset: **Redis → Supabase → Blob → file**.
