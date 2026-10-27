import { coerceStoreData, emptyStoreData } from "@/lib/store-coerce";
import { getSupabaseAdmin, supabaseStoreConfigured } from "@/lib/supabase-admin";
import type { Job, JobSource, PersonalUser, StoreData, WebThread } from "@/lib/types";

function threadStoreKey(ownerUserId: string, source: "web" | "api", threadId: string) {
  return `${ownerUserId}:${source}:${threadId}`;
}

/**
 * When true, hot reads prefer pa_* tables over the single jsonb blob.
 * Dual-write still runs whenever Supabase is configured (see dualWriteRelationalEnabled).
 * Opt in after migrating: PERSONAL_AGENTS_RELATIONAL=1
 */
export function relationalStoreEnabled() {
  if (!supabaseStoreConfigured()) return false;
  const v = process.env.PERSONAL_AGENTS_RELATIONAL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function dualWriteRelationalEnabled() {
  return supabaseStoreConfigured();
}

export const MAX_JOBS_PER_USER = Math.min(
  Math.max(Number(process.env.PERSONAL_AGENTS_MAX_JOBS_PER_USER) || 200, 20),
  500,
);

type JobRow = {
  id: string;
  owner_user_id: string;
  source: string;
  web_thread_id: string | null;
  status: string;
  prompt: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function jobToRow(job: Job): JobRow {
  const {
    id,
    ownerUserId,
    source,
    webThreadId,
    status,
    prompt,
    createdAt,
    updatedAt,
    ...rest
  } = job;
  return {
    id,
    owner_user_id: ownerUserId,
    source: source ?? "web",
    web_thread_id: webThreadId ?? null,
    status,
    prompt: prompt ?? "",
    data: rest as unknown as Record<string, unknown>,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function rowToJob(row: JobRow): Job {
  const data = (row.data && typeof row.data === "object" ? row.data : {}) as Omit<
    Job,
    "id" | "ownerUserId" | "source" | "webThreadId" | "status" | "prompt" | "createdAt" | "updatedAt"
  >;
  return {
    ...data,
    id: row.id,
    ownerUserId: row.owner_user_id,
    source: row.source as JobSource,
    webThreadId: row.web_thread_id ?? undefined,
    status: row.status as Job["status"],
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertJobRow(job: Job): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("pa_jobs").upsert(jobToRow(job), { onConflict: "id" });
  if (error) console.error("[store-relational] upsert job", job.id, error.message);
  await trimUserJobs(job.ownerUserId).catch(() => undefined);
}

export async function upsertWebThreadRow(thread: WebThread): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("pa_web_threads").upsert(
    {
      owner_user_id: thread.ownerUserId,
      source: thread.source,
      thread_id: thread.id,
      title: thread.title,
      cursor_agent_id: thread.cursorAgentId ?? null,
      cursor_agent_skills_hash: thread.cursorAgentSkillsHash ?? null,
      working: Boolean(thread.working),
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
    },
    { onConflict: "owner_user_id,source,thread_id" },
  );
  if (error) console.error("[store-relational] upsert thread", thread.id, error.message);
}

async function trimUserJobs(ownerUserId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pa_jobs")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .range(MAX_JOBS_PER_USER, MAX_JOBS_PER_USER + 200);
  if (error || !data?.length) return;
  const ids = data.map((r) => r.id as string);
  await supabase.from("pa_jobs").delete().in("id", ids);
}

export async function listJobRowsForThread(
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

export async function listJobRowsForUser(ownerUserId: string, limit: number): Promise<Job[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pa_jobs")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as JobRow[] | null)?.map(rowToJob) ?? [];
}

export async function getJobRow(id: string): Promise<Job | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("pa_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToJob(data as JobRow) : undefined;
}

export async function listWebThreadRows(
  ownerUserId: string,
  source: "web" | "api",
  limit: number,
): Promise<WebThread[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pa_web_threads")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("source", source)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.thread_id as string,
    ownerUserId: row.owner_user_id as string,
    source: row.source as "web" | "api",
    title: (row.title as string) || "New chat",
    cursorAgentId: (row.cursor_agent_id as string) || undefined,
    cursorAgentSkillsHash: (row.cursor_agent_skills_hash as string) || undefined,
    working: Boolean(row.working),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

/** Persist whole in-memory store into relational tables (migration / dual-write). */
export async function writeRelationalStore(store: StoreData): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const supabase = getSupabaseAdmin();

  await supabase.from("pa_global").upsert({
    id: "main",
    workspaces: store.workspaces ?? {},
    slack_installs: store.slackInstalls ?? {},
    processed_slack_messages: store.processedSlackMessages ?? [],
    audit_events: store.auditEvents ?? [],
    updated_at: new Date().toISOString(),
  });

  const ownerIds = new Set<string>([
    ...Object.keys(store.users ?? {}),
    ...Object.keys(store.files ?? {}),
    ...Object.keys(store.memories ?? {}),
    ...Object.keys(store.vaultItems ?? {}),
    ...Object.keys(store.connections ?? {}),
    ...Object.keys(store.orders ?? {}),
    ...Object.keys(store.slackThreads ?? {}).map((k) => k.split(":")[0]!).filter(Boolean),
    ...(store.jobs ?? []).map((j) => j.ownerUserId),
  ]);

  for (const ownerUserId of ownerIds) {
    const slackForUser: Record<string, unknown> = {};
    for (const [key, ref] of Object.entries(store.slackThreads ?? {})) {
      if (ref.ownerUserId === ownerUserId) slackForUser[key] = ref;
    }
    await supabase.from("pa_user_state").upsert({
      owner_user_id: ownerUserId,
      user_profile: store.users[ownerUserId] ?? null,
      files: store.files[ownerUserId] ?? [],
      memories: store.memories[ownerUserId] ?? [],
      vault_items: store.vaultItems[ownerUserId] ?? [],
      connections: store.connections[ownerUserId] ?? [],
      orders: store.orders[ownerUserId] ?? [],
      slack_threads: slackForUser,
      updated_at: new Date().toISOString(),
    });
  }

  const threads = Object.values(store.webThreads ?? {});
  if (threads.length) {
    const chunk = 100;
    for (let i = 0; i < threads.length; i += chunk) {
      const slice = threads.slice(i, i + chunk).map((t) => ({
        owner_user_id: t.ownerUserId,
        source: t.source,
        thread_id: t.id,
        title: t.title,
        cursor_agent_id: t.cursorAgentId ?? null,
        cursor_agent_skills_hash: t.cursorAgentSkillsHash ?? null,
        working: Boolean(t.working),
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      }));
      await supabase.from("pa_web_threads").upsert(slice, { onConflict: "owner_user_id,source,thread_id" });
    }
  }

  const jobs = store.jobs ?? [];
  if (jobs.length) {
    const chunk = 50;
    for (let i = 0; i < jobs.length; i += chunk) {
      const slice = jobs.slice(i, i + chunk).map(jobToRow);
      await supabase.from("pa_jobs").upsert(slice, { onConflict: "id" });
    }
  }
}

/** Assemble StoreData from relational tables (relational-primary mode). */
export async function readRelationalStore(): Promise<StoreData> {
  const supabase = getSupabaseAdmin();
  const store = emptyStoreData();

  const { data: globalRow } = await supabase.from("pa_global").select("*").eq("id", "main").maybeSingle();
  if (globalRow) {
    store.workspaces = (globalRow.workspaces as StoreData["workspaces"]) ?? {};
    store.slackInstalls = (globalRow.slack_installs as StoreData["slackInstalls"]) ?? {};
    store.processedSlackMessages = (globalRow.processed_slack_messages as string[]) ?? [];
    store.auditEvents = (globalRow.audit_events as StoreData["auditEvents"]) ?? [];
  }

  const { data: users } = await supabase.from("pa_user_state").select("*");
  for (const row of users ?? []) {
    const owner = row.owner_user_id as string;
    if (row.user_profile) store.users[owner] = row.user_profile as PersonalUser;
    store.files[owner] = (row.files as StoreData["files"][string]) ?? [];
    store.memories[owner] = (row.memories as StoreData["memories"][string]) ?? [];
    store.vaultItems[owner] = (row.vault_items as StoreData["vaultItems"][string]) ?? [];
    store.connections[owner] = (row.connections as StoreData["connections"][string]) ?? [];
    store.orders[owner] = (row.orders as StoreData["orders"][string]) ?? [];
    Object.assign(store.slackThreads, (row.slack_threads as StoreData["slackThreads"]) ?? {});
  }

  const { data: threads } = await supabase.from("pa_web_threads").select("*");
  for (const row of threads ?? []) {
    const thread: WebThread = {
      id: row.thread_id as string,
      ownerUserId: row.owner_user_id as string,
      source: row.source as "web" | "api",
      title: (row.title as string) || "New chat",
      cursorAgentId: (row.cursor_agent_id as string) || undefined,
      cursorAgentSkillsHash: (row.cursor_agent_skills_hash as string) || undefined,
      working: Boolean(row.working),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
    store.webThreads[threadStoreKey(thread.ownerUserId, thread.source, thread.id)] = thread;
  }

  const { data: jobs } = await supabase
    .from("pa_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000);
  store.jobs = (jobs as JobRow[] | null)?.map(rowToJob) ?? [];

  return coerceStoreData(store);
}

export async function relationalTablesReady(): Promise<boolean> {
  if (!supabaseStoreConfigured()) return false;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("pa_jobs").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export function sourceForList(source: Job["source"]): JobSource {
  return source === "api" ? "api" : source === "slack" ? "slack" : "web";
}
