import { coerceStoreData, emptyStoreData } from "@/lib/store-coerce";
import { getSupabaseAdmin, supabaseStoreConfigured } from "@/lib/supabase-admin";
import type { Job, JobSource, PersonalUser, StoreData, WebThread, Workspace } from "@/lib/types";

/**
 * Phase 2 storage without new DDL: shard into `personal_agents_store` rows.
 * (pa_* SQL migrations remain for a later dedicated-schema cutover.)
 *
 * Row ids:
 *   pa:g:main
 *   pa:u:{ownerUserId}
 *   pa:t:{owner}:{source}:{threadId}
 *   pa:j:{jobId}
 *   pa:idx:threads:{owner}:{source}  — O(1) sidebar list
 *   pa:idx:jobs:{owner}:{source}:{threadId} — newest job ids for a thread
 */
const TABLE = "personal_agents_store";
export const THREAD_INDEX_LIMIT = 40;
export const JOB_INDEX_LIMIT = 100;

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
export function threadIndexRowId(ownerUserId: string, source: string) {
  return `pa:idx:threads:${enc(ownerUserId)}:${enc(source)}`;
}
export function jobIndexRowId(ownerUserId: string, source: string, threadId: string) {
  return `pa:idx:jobs:${enc(ownerUserId)}:${enc(source)}:${enc(threadId)}`;
}

type StoredJobIndex = {
  kind: "job_index";
  ownerUserId: string;
  source: JobSource;
  threadId: string;
  jobIds: string[];
};

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

export type ThreadIndexEntry = {
  id: string;
  title: string;
  updatedAt: string;
  working: boolean;
};

type StoredThreadIndex = {
  kind: "thread_index";
  ownerUserId: string;
  source: "web" | "api";
  threads: ThreadIndexEntry[];
};

function threadToIndexEntry(thread: WebThread): ThreadIndexEntry {
  return {
    id: thread.id,
    title: thread.title || "New chat",
    updatedAt: thread.updatedAt,
    working: Boolean(thread.working),
  };
}

/**
 * Legacy default thread id is `main`. Keep it in the sidebar when it has a real
 * title (older chats); hide empty placeholders only.
 */
export function isSidebarThread(thread: { id: string; title?: string | null }) {
  // Dedicated Portfolio AI book — not a general chat in the /ai sidebar.
  if (thread.id === "portfolio") return false;
  if (thread.id !== "main") return true;
  const title = (thread.title || "").trim();
  if (!title) return false;
  const lower = title.toLowerCase();
  return lower !== "main" && lower !== "new chat";
}

function sortIndexEntries(entries: ThreadIndexEntry[]) {
  return [...entries].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

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
  await upsertJobIndexEntry(job).catch((err) =>
    console.error("[store-relational] job index", job.id, err),
  );
  await trimUserJobs(job.ownerUserId).catch(() => undefined);
}

/** O(1) read of workspace map for API-key auth (no users/jobs/threads assemble). */
export async function readGlobalWorkspaces(): Promise<Record<string, Workspace> | null> {
  if (!supabaseStoreConfigured()) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(TABLE).select("data").eq("id", globalRowId()).maybeSingle();
  if (error) throw error;
  const global = data?.data as StoredGlobal | undefined;
  if (!global || global.kind !== "global") return null;
  return global.workspaces ?? {};
}

async function upsertJobIndexEntry(job: Job): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const threadId = job.webThreadId ?? "main";
  const source = (job.source ?? "web") as JobSource;
  const indexId = jobIndexRowId(job.ownerUserId, source, threadId);
  const supabase = getSupabaseAdmin();
  const { data: existing, error: readErr } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", indexId)
    .maybeSingle();
  if (readErr) throw readErr;
  const prev = (existing?.data as StoredJobIndex | undefined)?.jobIds ?? [];
  const next = [job.id, ...prev.filter((id) => id !== job.id)].slice(0, JOB_INDEX_LIMIT);
  const payload: StoredJobIndex = {
    kind: "job_index",
    ownerUserId: job.ownerUserId,
    source,
    threadId,
    jobIds: next,
  };
  const error = await upsertRow(indexId, payload, job.updatedAt);
  if (error) throw error;
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
  await upsertThreadIndexEntry(thread).catch((err) =>
    console.error("[store-relational] thread index", thread.id, err),
  );
}

/** Merge one thread into the per-user sidebar index (primary-key row). */
export async function upsertThreadIndexEntry(thread: WebThread): Promise<void> {
  if (!dualWriteRelationalEnabled()) return;
  const supabase = getSupabaseAdmin();
  const indexId = threadIndexRowId(thread.ownerUserId, thread.source);
  const { data: existing, error: readErr } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", indexId)
    .maybeSingle();
  if (readErr) throw readErr;

  const prev = (existing?.data as StoredThreadIndex | undefined)?.threads ?? [];
  const nextMap = new Map(prev.filter(isSidebarThread).map((t) => [t.id, t]));
  if (isSidebarThread(thread)) {
    nextMap.set(thread.id, threadToIndexEntry(thread));
  } else {
    nextMap.delete(thread.id);
  }
  const threads = sortIndexEntries([...nextMap.values()]).slice(0, THREAD_INDEX_LIMIT);
  const payload: StoredThreadIndex = {
    kind: "thread_index",
    ownerUserId: thread.ownerUserId,
    source: thread.source,
    threads,
  };
  const error = await upsertRow(indexId, payload, thread.updatedAt);
  if (error) throw error;
}

/** O(1) sidebar read. Returns null if the index row is missing (caller should rebuild). */
export async function readThreadIndex(
  ownerUserId: string,
  source: "web" | "api",
  limit = THREAD_INDEX_LIMIT,
): Promise<ThreadIndexEntry[] | null> {
  if (!supabaseStoreConfigured()) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", threadIndexRowId(ownerUserId, source))
    .maybeSingle();
  if (error) throw error;
  if (!data?.data) return null;
  const stored = data.data as StoredThreadIndex;
  if (stored.kind !== "thread_index" || !Array.isArray(stored.threads)) return null;
  return sortIndexEntries(stored.threads.filter(isSidebarThread)).slice(0, limit);
}

/** Scan pa:t:* once, write index, return entries. */
export async function rebuildThreadIndex(
  ownerUserId: string,
  source: "web" | "api",
  limit = THREAD_INDEX_LIMIT,
): Promise<ThreadIndexEntry[]> {
  const rows = await listWebThreadRows(ownerUserId, source, Math.max(limit, THREAD_INDEX_LIMIT));
  const threads = sortIndexEntries(
    rows.filter(isSidebarThread).map(threadToIndexEntry),
  ).slice(0, limit);
  if (dualWriteRelationalEnabled()) {
    const payload: StoredThreadIndex = {
      kind: "thread_index",
      ownerUserId,
      source,
      threads,
    };
    const error = await upsertRow(threadIndexRowId(ownerUserId, source), payload);
    if (error) console.error("[store-relational] rebuild index", error.message);
  }
  return threads;
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
  const indexed = await readJobIndex(ownerUserId, source, threadId, limit);
  if (indexed) return indexed;

  // One-shot rebuild path for threads created before the job index existed.
  const rows = await listRowsByPrefix("pa:j:");
  const jobs = rows
    .map((r) => (r.data as StoredJob | null)?.job)
    .filter(
      (j): j is Job =>
        Boolean(
          j &&
            j.ownerUserId === ownerUserId &&
            (j.source ?? "web") === source &&
            (j.webThreadId ?? "main") === threadId,
        ),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (dualWriteRelationalEnabled() && jobs.length) {
    const payload: StoredJobIndex = {
      kind: "job_index",
      ownerUserId,
      source,
      threadId,
      jobIds: jobs.map((j) => j.id).slice(0, JOB_INDEX_LIMIT),
    };
    await upsertRow(jobIndexRowId(ownerUserId, source, threadId), payload).catch(() => undefined);
  }
  return jobs.slice(0, limit);
}

/** Newest-first jobs for a thread via pa:idx:jobs (falls back to null on miss). */
export async function readJobIndex(
  ownerUserId: string,
  source: JobSource,
  threadId: string,
  limit: number,
): Promise<Job[] | null> {
  if (!supabaseStoreConfigured()) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", jobIndexRowId(ownerUserId, source, threadId))
    .maybeSingle();
  if (error) throw error;
  const stored = data?.data as StoredJobIndex | undefined;
  if (!stored || stored.kind !== "job_index" || !Array.isArray(stored.jobIds) || !stored.jobIds.length) {
    return null;
  }
  const ids = stored.jobIds.slice(0, Math.max(limit, 1));
  const rowIds = ids.map((id) => jobRowId(id));
  const { data: jobRows, error: jobsErr } = await supabase.from(TABLE).select("id,data").in("id", rowIds);
  if (jobsErr) throw jobsErr;
  const byId = new Map<string, Job>();
  for (const row of jobRows ?? []) {
    const job = (row.data as StoredJob | null)?.job;
    if (job) byId.set(job.id, job);
  }
  return ids.map((id) => byId.get(id)).filter((j): j is Job => Boolean(j));
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

  // Rebuild sidebar indexes per owner+source (O(1) list path).
  const indexGroups = new Map<string, WebThread[]>();
  for (const thread of Object.values(store.webThreads ?? {})) {
    if (!isSidebarThread(thread)) continue;
    const key = `${thread.ownerUserId}\0${thread.source}`;
    const list = indexGroups.get(key) ?? [];
    list.push(thread);
    indexGroups.set(key, list);
  }
  for (const [, group] of indexGroups) {
    const ownerUserId = group[0]!.ownerUserId;
    const source = group[0]!.source;
    const threads = sortIndexEntries(group.map(threadToIndexEntry)).slice(0, THREAD_INDEX_LIMIT);
    const payload: StoredThreadIndex = { kind: "thread_index", ownerUserId, source, threads };
    const error = await upsertRow(threadIndexRowId(ownerUserId, source), payload, now);
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
