-- Run once in the Supabase SQL editor (service role) for Personal Agents JSON store.
-- Safe to re-run: uses IF NOT EXISTS.

create table if not exists public.personal_agents_store (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.personal_agents_store is
  'Single-row JSON blob for personal-agents control plane (users, jobs, API keys).';

alter table public.personal_agents_store enable row level security;
-- No policies: only the service role (server) can read/write.

-- Optional: private bucket for agent file uploads when PERSONAL_AGENTS_STORE=supabase
-- Create in Dashboard → Storage → New bucket: personal-agents-files (private)
