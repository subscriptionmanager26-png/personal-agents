import { coerceStoreData, emptyStoreData } from "@/lib/store-coerce";
import { getSupabaseAdmin, supabaseStoreConfigured } from "@/lib/supabase-admin";
import type { Job, JobSource, PersonalUser, StoreData, WebThread } from "@/lib/types";

/**
 * Phase 2 storage without new DDL: shard into `personal_agents_store` rows.
 * (pa_* SQL migrations remain for a later dedicated-schema cutover.)
 *
 * Row ids:
 *   pa:g:main
 *   pa:u:{ownerUserId}
 *   pa:t:{owner}:{source}:{threadId}
 *   pa:j:{jobId}
 */
const TABLE = "personal_agents_store";

function threadStoreKey(ownerUserId: string, source: "web" | "api", threadId: string) {
  return `${ownerUserId}:${source}:${threadId}`;
}

/** Owner ids look like `api:ws_…:uuid` — encode segments so `:` can't break keys. */
function enc(part: string) {
  return encodeURIComponent(part);
}

function globalRowId() {
  return "pa:g:main";
}
function userRowId(ownerUserId: string) {
  return `pa:u:${enc(ownerUserId)}`;
}
function threadRowId(ownerUserId: string, source: string, threadId: string) {
  return `pa:t:${enc(ownerUserId)}:${enc(source)}:${enc(threadId)}`;
}
function jobRowId(jobId: string) {
  return `pa:j:${enc(jobId)}`;
}

/**
 * When true, hot reads prefer sharded pa:* rows over the monolithic `main` blob.
 * Dual-write runs whenever Supabase is configured.
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

type StoredJob = { kind: "job"; job: Job };
type StoredThread = { kind: "thread"; thread: WebThread };
type StoredUser = {
  kind: "user";
  ownerUserId: string;
  userProfile: PersonalUser | null;
  files: StoreData["files"][string];
  memories: StoreData["memories"][string];
  vaultItems: StoreData["vaultItems"][string];
  connections: StoreData["connections"][string];
  orders: StoreData["orders"][string];
  slackThreads: StoreData["slackThreads"];
};
type StoredGlobal = {
  kind: "global";
  workspaces: StoreData["workspaces"];
  slackInstalls: StoreData["slackInstalls"];
  processedSlackMessages: string[];
  auditEvents: StoreData["auditEvents"];
};

async function upsertRow(id: string, data: unknown, updatedAt?: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from(TABLE).upsert({
    id,
    data,
    updated_at: updatedAt ?? new Date().toISOString(),
  });
  return error;
}

export async function upsertJobRow(job: Job): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const payload: StoredJob = { kind: "job", job };
  const error = await upsertRow(jobRowId(job.id), payload, job.updatedAt);
  if (error) console.error("[store-relational] upsert job", job.id, error.message);
  await trimUserJobs(job.ownerUserId).catch(() => undefined);
}

export async function upsertWebThreadRow(thread: WebThread): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const payload: StoredThread = { kind: "thread", thread };
  const error = await upsertRow(
    threadRowId(thread.ownerUserId, thread.source, thread.id),
    payload,
    thread.updatedAt,
  );
  if (error) console.error("[store-relational] upsert thread", thread.id, error.message);
}

async function listRowsByPrefix(prefix: string): Promise<Array<{ id: string; data: unknown; updated_at: string }>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,data,updated_at")
    .like("id", `${prefix}%`)
    .limit(5000);
  if (error) throw error;
  return (data as Array<{ id: string; data: unknown; updated_at: string }> | null) ?? [];
}

async function trimUserJobs(ownerUserId: string) {
  const rows = await listRowsByPrefix("pa:j:");
  const jobs = rows
    .map((r) => (r.data as StoredJob | null)?.job)
    .filter((j): j is Job => Boolean(j && j.ownerUserId === ownerUserId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const drop = jobs.slice(MAX_JOBS_PER_USER);
  if (!drop.length) return;
  const supabase = getSupabaseAdmin();
  await supabase.from(TABLE).delete().in(
    "id",
    drop.map((j) => jobRowId(j.id)),
  );
}

export async function listJobRowsForThread(
  ownerUserId: string,
  source: JobSource,
  threadId: string,
  limit: number,
): Promise<Job[]> {
  const rows = await listRowsByPrefix("pa:j:");
  return rows
    .map((r) => (r.data as StoredJob | null)?.job)
    .filter(
      (j): j is Job =>
        Boolean(j && j.ownerUserId === ownerUserId && (j.source ?? "web") === source && j.webThreadId === threadId),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export async function listJobRowsForUser(ownerUserId: string, limit: number): Promise<Job[]> {
  const rows = await listRowsByPrefix("pa:j:");
  return rows
    .map((r) => (r.data as StoredJob | null)?.job)
    .filter((j): j is Job => Boolean(j && j.ownerUserId === ownerUserId))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);
}

export async function getJobRow(id: string): Promise<Job | undefined> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", jobRowId(id))
    .maybeSingle();
  if (error) throw error;
  const job = (data?.data as StoredJob | undefined)?.job;
  return job;
}

export async function listWebThreadRows(
  ownerUserId: string,
  source: "web" | "api",
  limit: number,
): Promise<WebThread[]> {
  const rows = await listRowsByPrefix(`pa:t:${enc(ownerUserId)}:${enc(source)}:`);
  return rows
    .map((r) => (r.data as StoredThread | null)?.thread)
    .filter((t): t is WebThread => Boolean(t))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);
}

/** Persist whole in-memory store into sharded rows (migration / dual-write). */
export async function writeRelationalStore(store: StoreData): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const now = new Date().toISOString();

  const globalPayload: StoredGlobal = {
    kind: "global",
    workspaces: store.workspaces ?? {},
    slackInstalls: store.slackInstalls ?? {},
    processedSlackMessages: store.processedSlackMessages ?? [],
    auditEvents: store.auditEvents ?? [],
  };
  const gErr = await upsertRow(globalRowId(), globalPayload, now);
  if (gErr) throw gErr;

  const ownerIds = new Set<string>([
    ...Object.keys(store.users ?? {}),
    ...Object.keys(store.files ?? {}),
    ...Object.keys(store.memories ?? {}),
    ...Object.keys(store.vaultItems ?? {}),
    ...Object.keys(store.connections ?? {}),
    ...Object.keys(store.orders ?? {}),
    ...Object.values(store.slackThreads ?? {}).map((ref) => ref.ownerUserId).filter(Boolean),
    ...(store.jobs ?? []).map((j) => j.ownerUserId),
    ...Object.values(store.webThreads ?? {}).map((t) => t.ownerUserId),
  ]);

  for (const ownerUserId of ownerIds) {
    const slackForUser: StoreData["slackThreads"] = {};
    for (const [key, ref] of Object.entries(store.slackThreads ?? {})) {
      if (ref.ownerUserId === ownerUserId) slackForUser[key] = ref;
    }
    const payload: StoredUser = {
      kind: "user",
      ownerUserId,
      userProfile: store.users[ownerUserId] ?? null,
      files: store.files[ownerUserId] ?? [],
      memories: store.memories[ownerUserId] ?? [],
      vaultItems: store.vaultItems[ownerUserId] ?? [],
      connections: store.connections[ownerUserId] ?? [],
      orders: store.orders[ownerUserId] ?? [],
      slackThreads: slackForUser,
    };
    const error = await upsertRow(userRowId(ownerUserId), payload, now);
    if (error) throw error;
  }

  for (const thread of Object.values(store.webThreads ?? {})) {
    const payload: StoredThread = { kind: "thread", thread };
    const error = await upsertRow(
      threadRowId(thread.ownerUserId, thread.source, thread.id),
      payload,
      thread.updatedAt || now,
    );
    if (error) throw error;
  }

  for (const job of store.jobs ?? []) {
    const payload: StoredJob = { kind: "job", job };
    const error = await upsertRow(jobRowId(job.id), payload, job.updatedAt || now);
    if (error) throw error;
  }
}

/** Assemble StoreData from sharded pa:* rows (relational-primary mode). */
export async function readRelationalStore(): Promise<StoreData> {
  const store = emptyStoreData();

  const supabase = getSupabaseAdmin();
  const { data: globalRow, error: gErr } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", globalRowId())
    .maybeSingle();
  if (gErr) throw gErr;
  const global = globalRow?.data as StoredGlobal | undefined;
  if (global?.kind === "global") {
    store.workspaces = global.workspaces ?? {};
    store.slackInstalls = global.slackInstalls ?? {};
    store.processedSlackMessages = global.processedSlackMessages ?? [];
    store.auditEvents = global.auditEvents ?? [];
  }

  const users = await listRowsByPrefix("pa:u:");
  for (const row of users) {
    const u = row.data as StoredUser | null;
    if (!u || u.kind !== "user") continue;
    const owner = u.ownerUserId;
    if (u.userProfile) store.users[owner] = u.userProfile;
    store.files[owner] = u.files ?? [];
    store.memories[owner] = u.memories ?? [];
    store.vaultItems[owner] = u.vaultItems ?? [];
    store.connections[owner] = u.connections ?? [];
    store.orders[owner] = u.orders ?? [];
    Object.assign(store.slackThreads, u.slackThreads ?? {});
  }

  const threads = await listRowsByPrefix("pa:t:");
  for (const row of threads) {
    const t = (row.data as StoredThread | null)?.thread;
    if (!t) continue;
    store.webThreads[threadStoreKey(t.ownerUserId, t.source, t.id)] = t;
  }

  const jobs = await listRowsByPrefix("pa:j:");
  store.jobs = jobs
    .map((r) => (r.data as StoredJob | null)?.job)
    .filter((j): j is Job => Boolean(j))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return coerceStoreData(store);
}

export async function relationalTablesReady(): Promise<boolean> {
  if (!supabaseStoreConfigured()) return false;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from(TABLE).select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export function sourceForList(source: Job["source"]): JobSource {
  return source === "api" ? "api" : source === "slack" ? "slack" : "web";
}
