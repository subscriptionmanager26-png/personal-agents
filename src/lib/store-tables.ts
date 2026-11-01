/**
 * Scale path: real Postgres tables (pa_jobs / pa_web_threads / pa_dispatch_queue).
 * Opt in with PERSONAL_AGENTS_TABLES=1 after applying scripts/supabase-pa-tables-scale.sql.
 */
import { getSupabaseAdmin, supabaseStoreConfigured } from "@/lib/supabase-admin";
import type { Job, JobSource, StreamEvent, WebThread } from "@/lib/types";

export function tablesStoreEnabled() {
  if (!supabaseStoreConfigured()) return false;
  const v = process.env.PERSONAL_AGENTS_TABLES?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

type JobRow = {
  id: string;
  owner_user_id: string;
  source: string;
  web_thread_id: string | null;
  status: string;
  prompt: string;
  data: Record<string, unknown> | null;
  client_send_id: string | null;
  dispatch_claimed_at: string | null;
  claim_version: number;
  cursor_agent_id: string | null;
  cursor_run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type ThreadRow = {
  owner_user_id: string;
  source: "web" | "api";
  thread_id: string;
  title: string;
  cursor_agent_id: string | null;
  cursor_agent_skills_hash: string | null;
  agent_create_lock_at: string | null;
  agent_create_lock_job_id: string | null;
  working: boolean;
  created_at: string;
  updated_at: string;
};

function jobToRow(job: Job): Omit<JobRow, "claim_version"> & { claim_version?: number } {
  const {
    id,
    ownerUserId,
    source,
    webThreadId,
    status,
    prompt,
    clientSendId,
    dispatchClaimedAt,
    cursorAgentId,
    cursorRunId,
    error,
    createdAt,
    updatedAt,
    ...rest
  } = job;
  return {
    id,
    owner_user_id: ownerUserId,
    source,
    web_thread_id: webThreadId ?? null,
    status,
    prompt,
    client_send_id: clientSendId ?? null,
    dispatch_claimed_at: dispatchClaimedAt ?? null,
    cursor_agent_id: cursorAgentId ?? null,
    cursor_run_id: cursorRunId ?? null,
    error: error ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    data: rest as unknown as Record<string, unknown>,
  };
}

function rowToJob(row: JobRow): Job {
  const data = (row.data ?? {}) as Partial<Job>;
  return {
    ...data,
    id: row.id,
    ownerUserId: row.owner_user_id,
    source: row.source as JobSource,
    webThreadId: row.web_thread_id ?? undefined,
    status: row.status as Job["status"],
    prompt: row.prompt,
    clientSendId: row.client_send_id ?? undefined,
    dispatchClaimedAt: row.dispatch_claimed_at ?? undefined,
    cursorAgentId: row.cursor_agent_id ?? undefined,
    cursorRunId: row.cursor_run_id ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: data.events ?? [],
    stream: (data.stream as StreamEvent[] | undefined) ?? [],
  };
}

function threadToRow(thread: WebThread): ThreadRow {
  return {
    owner_user_id: thread.ownerUserId,
    source: thread.source,
    thread_id: thread.id,
    title: thread.title,
    cursor_agent_id: thread.cursorAgentId ?? null,
    cursor_agent_skills_hash: thread.cursorAgentSkillsHash ?? null,
    agent_create_lock_at: thread.agentCreateLockAt ?? null,
    agent_create_lock_job_id: thread.agentCreateLockJobId ?? null,
    working: Boolean(thread.working),
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
  };
}

function rowToThread(row: ThreadRow): WebThread {
  return {
    id: row.thread_id,
    ownerUserId: row.owner_user_id,
    source: row.source,
    title: row.title,
    cursorAgentId: row.cursor_agent_id ?? undefined,
    cursorAgentSkillsHash: row.cursor_agent_skills_hash ?? undefined,
    agentCreateLockAt: row.agent_create_lock_at ?? undefined,
    agentCreateLockJobId: row.agent_create_lock_job_id ?? undefined,
    working: row.working,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function tablesWriteJob(job: Job): Promise<void> {
  const supabase = getSupabaseAdmin();
  const row = jobToRow(job);
  const { error } = await supabase.from("pa_jobs").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function tablesGetJob(id: string): Promise<Job | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("pa_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return rowToJob(data as JobRow);
}

export async function tablesListJobsForThread(
  ownerUserId: string,
  source: JobSource,
  threadId: string,
  limit: number,
): Promise<Job[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pa_jobs")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("source", source)
    .eq("web_thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as JobRow[] | null)?.map(rowToJob) ?? [];
}

export async function tablesFindJobByClientSendId(input: {
  ownerUserId: string;
  source: JobSource;
  webThreadId: string;
  clientSendId: string;
}): Promise<Job | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pa_jobs")
    .select("*")
    .eq("owner_user_id", input.ownerUserId)
    .eq("source", input.source)
    .eq("web_thread_id", input.webThreadId)
    .eq("client_send_id", input.clientSendId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return rowToJob(data as JobRow);
}

export async function tablesClaimJobDispatch(
  jobId: string,
  ownerUserId: string,
  ttlSeconds = 90,
): Promise<"claimed" | "already_dispatched" | "busy" | "missing"> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("pa_claim_job_dispatch", {
    p_job_id: jobId,
    p_owner: ownerUserId,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw error;
  const result = String(data || "missing");
  if (
    result === "claimed" ||
    result === "already_dispatched" ||
    result === "busy" ||
    result === "missing"
  ) {
    return result;
  }
  return "missing";
}

export async function tablesWriteThread(thread: WebThread): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("pa_web_threads").upsert(threadToRow(thread), {
    onConflict: "owner_user_id,source,thread_id",
  });
  if (error) throw error;
}

export async function tablesGetThread(
  ownerUserId: string,
  source: "web" | "api",
  threadId: string,
): Promise<WebThread | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pa_web_threads")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("source", source)
    .eq("thread_id", threadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return rowToThread(data as ThreadRow);
}

export async function tablesBeginThreadAgentCreate(
  ownerUserId: string,
  source: "web" | "api",
  threadId: string,
  jobId: string,
): Promise<"reuse" | "create" | "wait" | { mode: "reuse"; agentId: string }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("pa_begin_thread_agent_create", {
    p_owner: ownerUserId,
    p_source: source,
    p_thread: threadId,
    p_job_id: jobId,
    p_ttl_seconds: 180,
  });
  if (error) throw error;
  const result = String(data || "create");
  if (result === "wait" || result === "create") return result;
  if (result.startsWith("reuse:")) {
    return { mode: "reuse", agentId: result.slice("reuse:".length) };
  }
  return "create";
}

export async function tablesClearThreadAgentCreateLock(
  ownerUserId: string,
  source: "web" | "api",
  threadId: string,
  jobId: string,
): Promise<void> {
  const thread = await tablesGetThread(ownerUserId, source, threadId);
  if (!thread) return;
  if (thread.agentCreateLockJobId && thread.agentCreateLockJobId !== jobId) return;
  delete thread.agentCreateLockAt;
  delete thread.agentCreateLockJobId;
  thread.updatedAt = new Date().toISOString();
  await tablesWriteThread(thread);
}

export async function tablesEnqueueDispatch(jobId: string, ownerUserId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  // Ignore unique violation on open job — already queued.
  const { error } = await supabase.from("pa_dispatch_queue").insert({
    job_id: jobId,
    owner_user_id: ownerUserId,
  });
  if (error && error.code !== "23505") throw error;
}

export async function tablesMarkDispatchDone(jobId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("pa_dispatch_queue")
    .update({ done_at: new Date().toISOString(), locked_at: null, locked_by: null })
    .eq("job_id", jobId)
    .is("done_at", null);
  if (error) throw error;
}

export async function tablesLeaseDispatchBatch(workerId: string, limit = 5) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("pa_lease_dispatch_batch", {
    p_worker: workerId,
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) throw error;
  return (data as Array<{ id: number; job_id: string; owner_user_id: string; attempts: number }> | null) ?? [];
}

export async function tablesFailDispatchLease(
  queueId: number,
  detail: string,
  retryDelaySeconds = 30,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const availableAt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
  const { error } = await supabase
    .from("pa_dispatch_queue")
    .update({
      last_error: detail.slice(0, 500),
      locked_at: null,
      locked_by: null,
      available_at: availableAt,
    })
    .eq("id", queueId);
  if (error) throw error;
}
