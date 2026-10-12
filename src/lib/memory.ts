import { randomId } from "@/lib/crypto";
import { getStore, updateStore } from "@/lib/store";
import { scrub } from "@/lib/trace";
import type { MemoryEntry, MemoryKind } from "@/lib/types";

export const MAX_TITLE = 120;
export const MAX_CONTENT = 2000;
const MAX_ENTRIES_PER_USER = 500;
const MAX_AUTO_EPISODES = 60;
const PACK_BUDGET_CHARS = 7000;

const CREDENTIAL_WORDS = /\b(password|passcode|passphrase|otp|cvv|pin code|seed phrase|private key)\b/i;

/** Returns why this text must not be stored as memory, or undefined when it is fine. */
export function memoryRejection(text: string) {
  if (CREDENTIAL_WORDS.test(text)) return "Memory must not contain credentials or one-time codes.";
  if (scrub(text) !== text) return "Memory must not contain tokens or keys.";
  return undefined;
}

export function clampImportance(value: unknown) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

function normalizeKind(kind: unknown): MemoryKind {
  const k = typeof kind === "string" ? kind.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_") : "";
  return k.slice(0, 40) || "note";
}

function withDefaults(m: MemoryEntry): MemoryEntry {
  return { ...m, importance: clampImportance(m.importance ?? 3) };
}

function rank(a: MemoryEntry, b: MemoryEntry) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.importance !== b.importance) return b.importance - a.importance;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export async function listMemories(ownerUserId: string) {
  const store = await getStore();
  return (store.memories[ownerUserId] ?? []).map(withDefaults).sort(rank);
}

export async function createMemory(input: {
  ownerUserId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  importance?: number;
  pinned?: boolean;
  source?: MemoryEntry["source"];
  sourceJobId?: string;
}) {
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: randomId("mem"),
    ownerUserId: input.ownerUserId,
    kind: normalizeKind(input.kind),
    title: input.title.trim().slice(0, MAX_TITLE),
    content: input.content.trim().slice(0, MAX_CONTENT),
    importance: clampImportance(input.importance ?? 3),
    pinned: Boolean(input.pinned),
    source: input.source ?? "user",
    sourceJobId: input.sourceJobId,
    createdAt: now,
    updatedAt: now,
  };
  return updateStore((store) => {
    const list = (store.memories[input.ownerUserId] ?? []).map(withDefaults);
    list.unshift(entry);
    if (input.source === "auto") {
      const autos = list.filter((m) => m.source === "auto");
      const drop = new Set(
        autos
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(MAX_AUTO_EPISODES)
          .map((m) => m.id),
      );
      store.memories[input.ownerUserId] = list.filter((m) => !drop.has(m.id));
    } else {
      // Over the cap, drop the least important, oldest entries first.
      store.memories[input.ownerUserId] = list.sort(rank).slice(0, MAX_ENTRIES_PER_USER);
    }
    return entry;
  });
}

export async function updateMemory(
  ownerUserId: string,
  id: string,
  patch: Partial<Pick<MemoryEntry, "kind" | "title" | "content" | "pinned" | "importance">>,
) {
  return updateStore((store) => {
    const list = store.memories[ownerUserId] ?? [];
    const entry = list.find((m) => m.id === id && m.ownerUserId === ownerUserId);
    if (!entry) return undefined;
    if (patch.kind !== undefined) entry.kind = normalizeKind(patch.kind);
    if (patch.title !== undefined) entry.title = patch.title.trim().slice(0, MAX_TITLE);
    if (patch.content !== undefined) entry.content = patch.content.trim().slice(0, MAX_CONTENT);
    if (patch.pinned !== undefined) entry.pinned = patch.pinned;
    if (patch.importance !== undefined) entry.importance = clampImportance(patch.importance);
    entry.updatedAt = new Date().toISOString();
    return withDefaults(entry);
  });
}

export async function deleteMemory(ownerUserId: string, id: string) {
  return updateStore((store) => {
    const list = store.memories[ownerUserId] ?? [];
    const next = list.filter((m) => !(m.id === id && m.ownerUserId === ownerUserId));
    store.memories[ownerUserId] = next;
    return next.length !== list.length;
  });
}

export async function searchMemories(
  ownerUserId: string,
  opts: { query?: string; kind?: string; limit?: number },
) {
  const terms = (opts.query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const kind = opts.kind ? normalizeKind(opts.kind) : undefined;
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const scored = (await listMemories(ownerUserId))
    .filter((m) => !kind || m.kind === kind)
    .map((m) => {
      const hay = `${m.title}\n${m.content}\n${m.kind}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      return { m, hits };
    })
    .filter(({ hits }) => !terms.length || hits > 0)
    .sort((a, b) => b.hits - a.hits || rank(a.m, b.m));
  return scored.slice(0, limit).map(({ m }) => m);
}

function packLine(m: MemoryEntry) {
  return `- (${m.id}) [${m.kind}, importance ${m.importance}${m.pinned ? ", pinned" : ""}, ${m.updatedAt.slice(0, 10)}] ${m.title}: ${m.content}`;
}

/** Highest-ranked memories that fit the prompt budget, plus how many were left out. */
export async function buildMemoryPack(ownerUserId: string, budget = PACK_BUDGET_CHARS) {
  const memories = await listMemories(ownerUserId);
  if (!memories.length) return { text: "No saved memory yet.", omitted: 0 };
  const lines: string[] = [];
  let used = 0;
  for (const m of memories) {
    const line = packLine(m);
    if (used + line.length > budget) continue;
    lines.push(line);
    used += line.length;
  }
  return { text: lines.join("\n"), omitted: memories.length - lines.length };
}

/** Minimal record of a chat when the agent saved nothing itself. */
export async function addAutoEpisode(ownerUserId: string, jobId: string, prompt: string, reply: string) {
  const clip = (s: string, n: number) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  const content = `Asked: ${clip(prompt, 300)}\nAnswered: ${clip(reply, 500)}`;
  if (memoryRejection(content)) return undefined;
  return createMemory({
    ownerUserId,
    kind: "episode",
    title: `Chat on ${new Date().toISOString().slice(0, 10)}: ${clip(prompt, 60)}`,
    content,
    importance: 1,
    source: "auto",
    sourceJobId: jobId,
  });
}
