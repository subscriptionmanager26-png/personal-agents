import { randomId } from "@/lib/crypto";
import { getStore, updateStore } from "@/lib/store";
import type { MemoryEntry, MemoryKind } from "@/lib/types";

export const MEMORY_KINDS: MemoryKind[] = ["preference", "fact", "note", "research_summary"];

function isActive(m: MemoryEntry) {
  return m.status !== "suggested";
}

export async function listMemories(ownerUserId: string) {
  const store = await getStore();
  return (store.memories[ownerUserId] ?? []).slice().sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function createMemory(input: {
  ownerUserId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  pinned?: boolean;
}) {
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: randomId("mem"),
    ownerUserId: input.ownerUserId,
    kind: input.kind,
    title: input.title.trim(),
    content: input.content.trim(),
    pinned: Boolean(input.pinned),
    createdAt: now,
    updatedAt: now,
  };
  return updateStore((store) => {
    const list = store.memories[input.ownerUserId] ?? [];
    list.unshift(entry);
    store.memories[input.ownerUserId] = list;
    return entry;
  });
}

function sameMemory(a: { title: string; content: string }, b: { title: string; content: string }) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a.title) === norm(b.title) || norm(a.content) === norm(b.content);
}

/** Stores agent-proposed memories for review; skips ones the user already has. Returns the new ids. */
export async function addSuggestedMemories(
  ownerUserId: string,
  sourceJobId: string,
  suggestions: { kind: MemoryKind; title: string; content: string }[],
) {
  if (!suggestions.length) return [];
  return updateStore((store) => {
    const list = store.memories[ownerUserId] ?? [];
    const now = new Date().toISOString();
    const added: string[] = [];
    for (const s of suggestions) {
      if (list.some((m) => sameMemory(m, s))) continue;
      const entry: MemoryEntry = {
        id: randomId("mem"),
        ownerUserId,
        kind: s.kind,
        title: s.title,
        content: s.content,
        pinned: false,
        status: "suggested",
        sourceJobId,
        createdAt: now,
        updatedAt: now,
      };
      list.unshift(entry);
      added.push(entry.id);
    }
    store.memories[ownerUserId] = list;
    return added;
  });
}

export async function updateMemory(
  ownerUserId: string,
  id: string,
  patch: Partial<Pick<MemoryEntry, "kind" | "title" | "content" | "pinned" | "status">>,
) {
  return updateStore((store) => {
    const list = store.memories[ownerUserId] ?? [];
    const entry = list.find((m) => m.id === id);
    if (!entry || entry.ownerUserId !== ownerUserId) return undefined;
    if (patch.kind) entry.kind = patch.kind;
    if (patch.title !== undefined) entry.title = patch.title.trim();
    if (patch.content !== undefined) entry.content = patch.content.trim();
    if (patch.pinned !== undefined) entry.pinned = patch.pinned;
    if (patch.status) entry.status = patch.status;
    entry.updatedAt = new Date().toISOString();
    return entry;
  });
}

export async function deleteMemory(ownerUserId: string, id: string) {
  return updateStore((store) => {
    const list = store.memories[ownerUserId] ?? [];
    const next = list.filter(
      (m) => !(m.id === id && m.ownerUserId === ownerUserId),
    );
    store.memories[ownerUserId] = next;
    return next.length !== list.length;
  });
}

/** Bounded memory pack for agent prompts — approved entries only, never vault secrets. */
export async function buildMemoryPack(ownerUserId: string, limit = 20) {
  const memories = (await listMemories(ownerUserId)).filter(isActive);
  const selected = [
    ...memories.filter((m) => m.pinned),
    ...memories.filter((m) => !m.pinned),
  ].slice(0, limit);
  if (!selected.length) return "No saved memory yet.";
  return selected
    .map(
      (m) =>
        `- [${m.kind}${m.pinned ? ", pinned" : ""}] ${m.title}: ${m.content}`,
    )
    .join("\n");
}
