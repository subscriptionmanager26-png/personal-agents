-- Personal Agents relational store (replaces single-row jsonb hot path).
-- Safe to re-run. Service role only (RLS on, no policies).

create table if not exists public.pa_global (
  id text primary key default 'main',
  workspaces jsonb not null default '{}'::jsonb,
  slack_installs jsonb not null default '{}'::jsonb,
  processed_slack_messages jsonb not null default '[]'::jsonb,
  audit_events jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.pa_user_state (
  owner_user_id text primary key,
  user_profile jsonb,
  files jsonb not null default '[]'::jsonb,
  memories jsonb not null default '[]'::jsonb,
  vault_items jsonb not null default '[]'::jsonb,
  connections jsonb not null default '[]'::jsonb,
  orders jsonb not null default '[]'::jsonb,
  slack_threads jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.pa_web_threads (
  owner_user_id text not null,
  source text not null check (source in ('web', 'api')),
  thread_id text not null,
  title text not null default 'New chat',
  cursor_agent_id text,
  cursor_agent_skills_hash text,
  working boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_user_id, source, thread_id)
);

create index if not exists pa_web_threads_owner_updated_idx
  on public.pa_web_threads (owner_user_id, source, updated_at desc);

create table if not exists public.pa_jobs (
  id text primary key,
  owner_user_id text not null,
  source text not null,
  web_thread_id text,
  status text not null,
  prompt text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists pa_jobs_owner_thread_created_idx
  on public.pa_jobs (owner_user_id, source, web_thread_id, created_at desc);

create index if not exists pa_jobs_owner_updated_idx
  on public.pa_jobs (owner_user_id, updated_at desc);

create index if not exists pa_jobs_active_idx
  on public.pa_jobs (status)
  where status in ('queued', 'dispatched', 'delivering');

alter table public.pa_global enable row level security;
alter table public.pa_user_state enable row level security;
alter table public.pa_web_threads enable row level security;
alter table public.pa_jobs enable row level security;

comment on table public.pa_jobs is
  'One row per Personal Agents job; stream/reply live in data jsonb.';
comment on table public.pa_web_threads is
  'Sidebar chat threads — list without loading job payloads.';
