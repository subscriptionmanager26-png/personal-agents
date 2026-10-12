import type { UiBlock } from "@/lib/types";

const MAX_TEXT = 300;
const MAX_COLUMNS = 12;
const MAX_ROWS = 200;
const MAX_SERIES = 6;
const MAX_POINTS = 1000;
const MAX_FIELDS = 12;
const KEY = /^[A-Za-z0-9_.-]{1,40}$/;

type Result = { block: UiBlock } | { error: string };

function str(v: unknown, max = MAX_TEXT) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function cell(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).slice(0, MAX_TEXT);
}

export function tableBlock(args: Record<string, unknown>): Result {
  const columns = Array.isArray(args.columns) ? args.columns.slice(0, MAX_COLUMNS) : [];
  const parsed = columns
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .map((c) => ({
      key: str(c.key, 40),
      label: str(c.label, 60) || str(c.key, 40),
      format: (["text", "number", "currency", "percent"] as const).find((f) => f === c.format),
    }))
    .filter((c) => KEY.test(c.key));
  if (!parsed.length) return { error: "columns must be a list of { key, label, format? }" };
  if (!Array.isArray(args.rows)) return { error: "rows must be a list of objects keyed by column key" };
  const rows = args.rows.slice(0, MAX_ROWS).map((r) => {
    const row = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    return Object.fromEntries(parsed.map((c) => [c.key, cell(row[c.key])]));
  });
  return {
    block: {
      kind: "table",
      title: str(args.title, 120) || undefined,
      columns: parsed.map(({ format, ...c }) => (format ? { ...c, format } : c)),
      rows,
    },
  };
}

export function chartBlock(args: Record<string, unknown>): Result {
  const chartType = (["line", "bar", "area"] as const).find((t) => t === args.chart_type) ?? "line";
  const xKey = str(args.x_key, 40);
  if (!KEY.test(xKey)) return { error: "x_key must name the field used for the x axis" };
  const series = (Array.isArray(args.series) ? args.series.slice(0, MAX_SERIES) : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s) => ({ key: str(s.key, 40), label: str(s.label, 60) || str(s.key, 40) }))
    .filter((s) => KEY.test(s.key));
  if (!series.length) return { error: "series must be a list of { key, label }" };
  if (!Array.isArray(args.data) || !args.data.length) return { error: "data must be a non-empty list of points" };
  const data = args.data.slice(0, MAX_POINTS).map((p) => {
    const point = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const out: Record<string, string | number> = { [xKey]: String(point[xKey] ?? "").slice(0, 40) };
    for (const s of series) {
      const v = point[s.key];
      if (typeof v === "number" && Number.isFinite(v)) out[s.key] = v;
    }
    return out;
  });
  return { block: { kind: "chart", title: str(args.title, 120) || undefined, chartType, xKey, series, data } };
}

export function cardBlock(args: Record<string, unknown>): Result {
  const title = str(args.title, 120);
  if (!title) return { error: "title is required" };
  const tone = (["info", "success", "warning"] as const).find((t) => t === args.tone);
  const fields = (Array.isArray(args.fields) ? args.fields.slice(0, MAX_FIELDS) : [])
    .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
    .map((f) => ({ label: str(f.label, 60), value: str(cell(f.value) === null ? "" : String(cell(f.value)), 200) }))
    .filter((f) => f.label);
  return {
    block: {
      kind: "card",
      title,
      body: str(args.body, 2000) || undefined,
      tone,
      fields: fields.length ? fields : undefined,
    },
  };
}

export function safeLoginUrl(raw: unknown) {
  try {
    const url = new URL(String(raw));
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
