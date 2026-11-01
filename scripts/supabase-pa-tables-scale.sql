-- Scale cutover: real jobs/threads tables + durable dispatch queue + CAS helpers.
-- Safe to re-run. Service role only (RLS on, no policies for anon).
-- Enable with PERSONAL_AGENTS_TABLES=1 after applying.

-- Base tables (idempotent with earlier scripts/supabase-relational-store-migration.sql)
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

alter table public.pa_web_threads
  add column if not exists agent_create_lock_at timestamptz,
  add column if not exists agent_create_lock_job_id text;

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

alter table public.pa_jobs
  add column if not exists client_send_id text,
  add column if not exists dispatch_claimed_at timestamptz,
  add column if not exists claim_version integer not null default 0,
  add column if not exists cursor_agent_id text,
  add column if not exists cursor_run_id text,
  add column if not exists error text;

create unique index if not exists pa_jobs_owner_thread_client_send_uidx
  on public.pa_jobs (owner_user_id, source, web_thread_id, client_send_id)
  where client_send_id is not null and client_send_id <> '';

create index if not exists pa_jobs_owner_thread_created_idx
  on public.pa_jobs (owner_user_id, source, web_thread_id, created_at desc);

create index if not exists pa_jobs_owner_updated_idx
  on public.pa_jobs (owner_user_id, updated_at desc);

create index if not exists pa_jobs_active_idx
  on public.pa_jobs (status)
  where status in ('queued', 'dispatched', 'delivering');

create index if not exists pa_jobs_queued_unclaimed_idx
  on public.pa_jobs (created_at)
  where status = 'queued' and cursor_run_id is null;

-- Append-only stream events (optional; job.data.stream remains for transition)
create table if not exists public.pa_job_stream_events (
  job_id text not null references public.pa_jobs (id) on delete cascade,
  seq integer not null,
  at timestamptz not null default now(),
  event jsonb not null,
  primary key (job_id, seq)
);

-- Durable dispatch queue — primary delivery; after() is a nudge only
create table if not exists public.pa_dispatch_queue (
  id bigserial primary key,
  job_id text not null,
  owner_user_id text not null,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pa_dispatch_queue_pending_idx
  on public.pa_dispatch_queue (available_at)
  where done_at is null;

create unique index if not exists pa_dispatch_queue_open_job_uidx
  on public.pa_dispatch_queue (job_id)
  where done_at is null;

-- CAS claim for Cursor dispatch
create or replace function public.pa_claim_job_dispatch(p_job_id text, p_owner text, p_ttl_seconds integer default 90)
returns text
language plpgsql
as $$
declare
  v_status text;
  v_run text;
  v_claimed timestamptz;
  v_now timestamptz := now();
begin
  select status, cursor_run_id, dispatch_claimed_at
    into v_status, v_run, v_claimed
  from public.pa_jobs
  where id = p_job_id and owner_user_id = p_owner
  for update;

  if not found then
    return 'missing';
  end if;

  if v_run is not null or v_status in ('dispatched', 'delivering', 'replied') then
    return 'already_dispatched';
  end if;

  if v_claimed is not null and v_claimed > v_now - make_interval(secs => p_ttl_seconds) then
    return 'busy';
  end if;

  update public.pa_jobs
     set dispatch_claimed_at = v_now,
         claim_version = claim_version + 1,
         updated_at = v_now
   where id = p_job_id and owner_user_id = p_owner;

  return 'claimed';
end;
$$;

-- Lease next dispatch queue rows (SKIP LOCKED)
create or replace function public.pa_lease_dispatch_batch(p_worker text, p_limit integer default 5, p_lease_seconds integer default 120)
returns setof public.pa_dispatch_queue
language plpgsql
as $$
begin
  return query
  with picked as (
    select q.id
      from public.pa_dispatch_queue q
     where q.done_at is null
       and q.available_at <= now()
       and (q.locked_at is null or q.locked_at < now() - make_interval(secs => p_lease_seconds))
     order by q.available_at asc
     for update skip locked
     limit greatest(p_limit, 1)
  )
  update public.pa_dispatch_queue q
     set locked_at = now(),
         locked_by = p_worker,
         attempts = q.attempts + 1
    from picked
   where q.id = picked.id
  returning q.*;
end;
$$;

-- Thread agent-create lock (CAS)
create or replace function public.pa_begin_thread_agent_create(
  p_owner text,
  p_source text,
  p_thread text,
  p_job_id text,
  p_ttl_seconds integer default 180
)
returns text
language plpgsql
as $$
declare
  v_agent text;
  v_lock_at timestamptz;
  v_lock_job text;
  v_now timestamptz := now();
begin
  insert into public.pa_web_threads (owner_user_id, source, thread_id, title, created_at, updated_at)
  values (p_owner, p_source, p_thread, 'New chat', v_now, v_now)
  on conflict (owner_user_id, source, thread_id) do nothing;

  select cursor_agent_id, agent_create_lock_at, agent_create_lock_job_id
    into v_agent, v_lock_at, v_lock_job
  from public.pa_web_threads
  where owner_user_id = p_owner and source = p_source and thread_id = p_thread
  for update;

  if v_agent is not null and v_agent <> '' then
    return 'reuse:' || v_agent;
  end if;

  if v_lock_at is not null
     and v_lock_at > v_now - make_interval(secs => p_ttl_seconds)
     and v_lock_job is not null
     and v_lock_job <> p_job_id then
    return 'wait';
  end if;

  update public.pa_web_threads
     set agent_create_lock_at = v_now,
         agent_create_lock_job_id = p_job_id,
         updated_at = v_now
   where owner_user_id = p_owner and source = p_source and thread_id = p_thread;

  return 'create';
end;
$$;

alter table public.pa_web_threads enable row level security;
alter table public.pa_jobs enable row level security;
alter table public.pa_job_stream_events enable row level security;
alter table public.pa_dispatch_queue enable row level security;

comment on table public.pa_dispatch_queue is
  'Durable Cursor dispatch work; workers lease via pa_lease_dispatch_batch.';
comment on function public.pa_claim_job_dispatch is
  'CAS claim for createAgent/createRun; returns claimed|busy|already_dispatched|missing.';
