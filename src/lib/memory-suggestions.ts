import { MEMORY_KINDS } from "@/lib/memory";
import { scrub } from "@/lib/trace";
import type { MemoryKind } from "@/lib/types";

export type MemorySuggestion = { kind: MemoryKind; title: string; content: string };

const BLOCK = /```memory[^\n]*\n([\s\S]*?)```/g;
const MAX_SUGGESTIONS = 5;
const MAX_TITLE = 80;
const MAX_CONTENT = 500;
const SENSITIVE = /password|passcode|passphrase|\botp\b|\bpin\b|\bcvv\b|api[\s_-]?key|secret|token|private key|seed phrase/i;

function parseBlock(body: string): unknown[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // tolerate one JSON object per line
    return trimmed
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      })
      .filter((v) => v !== undefined);
  }
}

function clean(raw: unknown): MemorySuggestion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim().slice(0, MAX_TITLE) : "";
  const content = typeof r.content === "string" ? r.content.trim().slice(0, MAX_CONTENT) : "";
  if (!title || !content) return undefined;
  // Never let credentials (or anything that looks like one) become memory.
  if (SENSITIVE.test(title) || SENSITIVE.test(content)) return undefined;
  if (scrub(title) !== title || scrub(content) !== content) return undefined;
  const kind = MEMORY_KINDS.includes(r.kind as MemoryKind) ? (r.kind as MemoryKind) : "note";
  return { kind, title, content };
}

/** Splits the agent's ```memory blocks out of its final message. */
export function extractMemorySuggestions(message: string): {
  text: string;
  suggestions: MemorySuggestion[];
} {
  const suggestions: MemorySuggestion[] = [];
  const text = message
    .replace(BLOCK, (_match, body: string) => {
      for (const raw of parseBlock(body)) {
        const s = clean(raw);
        if (s && suggestions.length < MAX_SUGGESTIONS) suggestions.push(s);
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: text || "Done.", suggestions };
}
