import crypto from "node:crypto";
import path from "node:path";

import { randomId } from "@/lib/crypto";
import { deleteObjects, fileKey, fileStorageAvailable, getObject, putObject } from "@/lib/file-storage";
import { getStore, updateStore } from "@/lib/store";
import { appendAudit } from "@/lib/users";
import type { FileKind, SheetSummary, UploadedFile } from "@/lib/types";

import { MAX_ATTACHMENTS, MAX_FILE_BYTES } from "@/lib/file-limits";

export { MAX_ATTACHMENTS, MAX_FILE_BYTES };
export const MAX_FILES_PER_USER = 200;

const MAX_PDF_CHARS = 1_000_000;
const MAX_CELLS = 500_000;
const MAX_SHEETS = 20;
const MAX_COLUMNS = 100;
const MAX_CELL_CHARS = 2_000;

export type Cell = string | number | boolean | null;
export type FileExtract =
  | { kind: "pdf"; pages: string[] }
  | { kind: "table"; sheets: { name: string; rows: Cell[][] }[] }
  | { kind: "image" };

type Failure = { error: string; code: 400 | 404 | 409 | 413 | 415 | 422 | 503 };

// ---------- Detection ----------

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function cleanFileName(raw: string) {
  const base = path.basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (base.length <= 120) return base;
  const ext = path.extname(base);
  return base.slice(0, 120 - ext.length) + ext;
}

const startsWith = (bytes: Buffer, sig: number[]) => sig.every((b, i) => bytes[i] === b);

function looksLikeImage(ext: string, bytes: Buffer) {
  if (ext === ".png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
  if (ext === ".jpg" || ext === ".jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (ext === ".webp") {
    return (
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes.length >= 12 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

/** Decides the type from the bytes; the extension only has to agree. */
export function detectFile(name: string, bytes: Buffer): { kind: FileKind; mimeType: string } | Failure {
  const ext = path.extname(name).toLowerCase();
  const unsupported = {
    error: "Only PDF, CSV, Excel (.xlsx, .xls), and images (PNG, JPG, WEBP) are supported.",
    code: 415,
  } as const;
  if (!MIME[ext]) return unsupported;
  const mismatch = { error: `${name} does not look like a real ${ext.slice(1).toUpperCase()} file.`, code: 415 } as const;
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  const isOle = startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  if (IMAGE_EXTS.has(ext)) {
    return looksLikeImage(ext, bytes) ? { kind: "image", mimeType: MIME[ext]! } : mismatch;
  }
  if (ext === ".pdf") {
    return bytes.subarray(0, 1024).includes("%PDF-") ? { kind: "pdf", mimeType: MIME[ext]! } : mismatch;
  }
  if (ext === ".xlsx" || ext === ".xls") {
    // Password-protected .xlsx files are OLE containers, so both signatures are spreadsheets.
    return isZip || isOle ? { kind: "xlsx", mimeType: MIME[ext]! } : mismatch;
  }
  if (isZip || isOle || bytes.subarray(0, 8192).includes(0)) return mismatch;
  return { kind: "csv", mimeType: MIME[ext]! };
}

// ---------- Extraction ----------

type Extracted =
  | { extract: FileExtract; pages?: number; sheets?: SheetSummary[]; extractedSize: number; truncated: boolean }
  | { needsPassword: true; wrongPassword: boolean }
  | Failure;

async function extractPdf(bytes: Buffer, password?: string): Promise<Extracted> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0, ...(password ? { password } : {}) });
  } catch (error) {
    const err = error as { name?: string; code?: number };
    if (err?.name === "PasswordException") return { needsPassword: true, wrongPassword: err.code === 2 };
    return { error: "This PDF could not be read. It may be damaged.", code: 422 };
  }
  try {
    const { totalPages, text } = await extractText(doc, { mergePages: false });
    const pages: string[] = [];
    let used = 0;
    let truncated = false;
    for (const page of text) {
      const clean = page.replace(/[ \t]+\n/g, "\n").trim();
      if (used + clean.length > MAX_PDF_CHARS) {
        truncated = true;
        break;
      }
      pages.push(clean);
      used += clean.length;
    }
    return { extract: { kind: "pdf", pages }, pages: totalPages, extractedSize: used, truncated };
  } finally {
    await doc.loadingTask.destroy().catch(() => undefined);
  }
}

function decodeText(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    // Excel's default "CSV" export is Windows-1252, not UTF-8.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function cell(value: unknown): Cell {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return String(value).slice(0, MAX_CELL_CHARS);
}

function summarize(sheets: { name: string; rows: Cell[][] }[]): SheetSummary[] {
  return sheets.map((s) => ({
    name: s.name,
    rows: s.rows.length,
    columns: s.rows.reduce((m, r) => Math.max(m, r.length), 0),
    header: (s.rows[0] ?? []).slice(0, 30).map((c) => (c === null ? "" : String(c).slice(0, 40))),
  }));
}

function capRows(rows: unknown[][], budget: { cells: number; truncated: boolean }) {
  const out: Cell[][] = [];
  for (const row of rows) {
    if (row.length > MAX_COLUMNS) budget.truncated = true;
    const r = row.slice(0, MAX_COLUMNS).map(cell);
    while (r.length && r[r.length - 1] === null) r.pop();
    if (!r.length) continue;
    if (budget.cells + r.length > MAX_CELLS) {
      budget.truncated = true;
      break;
    }
    budget.cells += r.length;
    out.push(r);
  }
  return out;
}

async function extractTable(kind: "csv" | "xlsx", bytes: Buffer): Promise<Extracted> {
  const budget = { cells: 0, truncated: false };
  const sheets: { name: string; rows: Cell[][] }[] = [];
  if (kind === "csv") {
    const Papa = (await import("papaparse")).default;
    const parsed = Papa.parse<string[]>(decodeText(bytes), { skipEmptyLines: "greedy" });
    if (!parsed.data.length) return { error: "This CSV file is empty.", code: 422 };
    sheets.push({ name: "Sheet1", rows: capRows(parsed.data, budget) });
  } else {
    const XLSX = await import("xlsx");
    let book;
    try {
      book = XLSX.read(bytes, { type: "buffer", dense: true, cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/password|encrypt/i.test(message)) {
        return {
          error: "Password-protected spreadsheets are not supported. Save a copy without a password and upload that.",
          code: 422,
        };
      }
      return { error: "This spreadsheet could not be read. It may be damaged.", code: 422 };
    }
    for (const name of book.SheetNames.slice(0, MAX_SHEETS)) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
      sheets.push({ name: name.slice(0, 80), rows: capRows(rows, budget) });
      if (budget.truncated) break;
    }
    if (book.SheetNames.length > sheets.length) budget.truncated = true;
  }
  return {
    extract: { kind: "table", sheets },
    sheets: summarize(sheets),
    extractedSize: budget.cells,
    truncated: budget.truncated,
  };
}

function extractFile(kind: FileKind, bytes: Buffer, password?: string) {
  if (kind === "image") {
    return { extract: { kind: "image" as const }, extractedSize: 0, truncated: false };
  }
  return kind === "pdf" ? extractPdf(bytes, password) : extractTable(kind, bytes);
}

// ---------- Records ----------

export async function listFiles(ownerUserId: string, limit = 50) {
  const store = await getStore();
  return (store.files[ownerUserId] ?? []).slice(0, limit);
}

export async function getFile(ownerUserId: string, fileId: string) {
  const store = await getStore();
  return (store.files[ownerUserId] ?? []).find((f) => f.id === fileId && f.ownerUserId === ownerUserId);
}

export async function uploadFile(input: {
  ownerUserId: string;
  name: string;
  bytes: Buffer;
}): Promise<{ file: UploadedFile } | Failure> {
  if (!fileStorageAvailable()) return { error: "File uploads are not configured on this server.", code: 503 };
  const name = cleanFileName(input.name);
  if (!name) return { error: "The file needs a name.", code: 400 };
  if (!input.bytes.length) return { error: `${name} is empty.`, code: 400 };
  if (input.bytes.length > MAX_FILE_BYTES) {
    return { error: `${name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`, code: 413 };
  }
  if ((await listFiles(input.ownerUserId, MAX_FILES_PER_USER)).length >= MAX_FILES_PER_USER) {
    return { error: `You can keep up to ${MAX_FILES_PER_USER} files. Delete some first.`, code: 409 };
  }
  const detected = detectFile(name, input.bytes);
  if ("error" in detected) return detected;

  const extracted = await extractFile(detected.kind, input.bytes);
  if ("error" in extracted) return extracted;

  const file: UploadedFile = {
    id: randomId("file"),
    ownerUserId: input.ownerUserId,
    name,
    kind: detected.kind,
    mimeType: detected.mimeType,
    size: input.bytes.length,
    sha256: crypto.createHash("sha256").update(input.bytes).digest("hex"),
    status: "needsPassword" in extracted ? "needs_password" : "ready",
    createdAt: new Date().toISOString(),
  };
  try {
    await putObject(fileKey(file.ownerUserId, file.id, "raw"), input.bytes, file.mimeType);
    if ("extract" in extracted) await saveExtract(file, extracted);
  } catch (err) {
    const message = err instanceof Error ? err.message : "File storage failed.";
    return {
      error: /bucket|storage|not configured/i.test(message)
        ? `File storage is not ready (${message}).`
        : message,
      code: 503,
    };
  }

  await updateStore((store) => {
    const list = store.files[file.ownerUserId] ?? [];
    list.unshift(file);
    store.files[file.ownerUserId] = list;
  });
  await appendAudit({ ownerUserId: file.ownerUserId, type: "file.upload", detail: `${file.id} ${file.kind} ${file.size} bytes` });
  return { file };
}

async function saveExtract(file: UploadedFile, extracted: Extract<Extracted, { extract: FileExtract }>) {
  await putObject(fileKey(file.ownerUserId, file.id, "extract"), JSON.stringify(extracted.extract), "application/json");
  Object.assign(file, {
    pages: extracted.pages,
    sheets: extracted.sheets,
    extractedSize: extracted.extractedSize,
    truncated: extracted.truncated || undefined,
  });
}

/** Opens an encrypted PDF. The password is used once and never stored. */
export async function unlockFile(
  ownerUserId: string,
  fileId: string,
  password: string,
): Promise<{ file: UploadedFile } | Failure> {
  const file = await getFile(ownerUserId, fileId);
  if (!file) return { error: "File not found.", code: 404 };
  if (file.status !== "needs_password") return { error: "This file is not locked.", code: 409 };
  if (!password || password.length > 256) return { error: "Enter the file's password.", code: 400 };
  const bytes = await getObject(fileKey(ownerUserId, fileId, "raw"));
  if (!bytes) return { error: "File content is missing.", code: 404 };
  const extracted = await extractFile(file.kind, bytes, password);
  if ("error" in extracted) return extracted;
  if ("needsPassword" in extracted) return { error: "That password is not right.", code: 422 };
  await saveExtract(file, extracted);
  const updated = await updateStore((store) => {
    const record = (store.files[ownerUserId] ?? []).find((f) => f.id === fileId);
    if (!record) return undefined;
    Object.assign(record, {
      status: "ready",
      pages: file.pages,
      sheets: file.sheets,
      extractedSize: file.extractedSize,
      truncated: file.truncated,
    });
    return { ...record };
  });
  if (!updated) return { error: "File not found.", code: 404 };
  await appendAudit({ ownerUserId, type: "file.unlock", detail: fileId });
  return { file: updated };
}

export async function deleteFile(ownerUserId: string, fileId: string) {
  const removed = await updateStore((store) => {
    const list = store.files[ownerUserId] ?? [];
    const next = list.filter((f) => f.id !== fileId);
    store.files[ownerUserId] = next;
    return next.length !== list.length;
  });
  if (removed) {
    await deleteObjects([fileKey(ownerUserId, fileId, "raw"), fileKey(ownerUserId, fileId, "extract")]);
    await appendAudit({ ownerUserId, type: "file.delete", detail: fileId });
  }
  return removed;
}

/** Ready files owned by this user, in the order given; errors name the first bad id. */
export async function resolveAttachments(ownerUserId: string, ids: unknown): Promise<{ files: UploadedFile[] } | { error: string }> {
  if (ids === undefined || ids === null) return { files: [] };
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return { error: "attachments must be a list of file ids." };
  const unique = [...new Set(ids as string[])];
  if (unique.length > MAX_ATTACHMENTS) return { error: `Attach at most ${MAX_ATTACHMENTS} files per message.` };
  const owned = new Map((await listFiles(ownerUserId, MAX_FILES_PER_USER)).map((f) => [f.id, f]));
  const files: UploadedFile[] = [];
  for (const id of unique) {
    const file = owned.get(id);
    if (!file) return { error: `File ${id} was not found.` };
    if (file.status === "needs_password") return { error: `${file.name} is password-protected. Unlock it first.` };
    if (file.status !== "ready") return { error: `${file.name} could not be read.` };
    files.push(file);
  }
  return { files };
}

export async function readExtract(file: UploadedFile): Promise<FileExtract | undefined> {
  if (file.status !== "ready") return undefined;
  const raw = await getObject(fileKey(file.ownerUserId, file.id, "extract"));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw.toString("utf8")) as FileExtract;
  } catch {
    return undefined;
  }
}

export async function readRaw(file: UploadedFile) {
  return getObject(fileKey(file.ownerUserId, file.id, "raw"));
}

// ---------- Views ----------

export function fileView(file: UploadedFile) {
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    size: file.size,
    status: file.status,
    pages: file.pages,
    sheets: file.sheets?.map(({ name, rows, columns }) => ({ name, rows, columns })),
    truncated: file.truncated ?? false,
    createdAt: file.createdAt,
  };
}

export function describeFile(file: UploadedFile) {
  if (file.kind === "image") {
    return `Image (${file.mimeType}) — use get_file_link to inspect / OCR the screenshot`;
  }
  if (file.kind === "pdf") {
    const text = file.extractedSize ? "" : ", no text layer (likely scanned)";
    return `PDF, ${file.pages ?? "?"} pages${text}`;
  }
  const sheets = (file.sheets ?? []).map((s) => `"${s.name}" ${s.rows} rows × ${s.columns} cols`);
  return `${file.kind === "csv" ? "CSV" : "Spreadsheet"}: ${sheets.join("; ")}`;
}

function parsePages(spec: string | undefined, total: number) {
  if (!spec) return undefined;
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return null;
    const from = Number(m[1]);
    const to = Math.min(Number(m[2] ?? m[1]), total);
    for (let p = from; p <= to && pages.size < 500; p += 1) if (p >= 1) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

const csvCell = (c: Cell) => {
  const s = c === null ? "" : String(c);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A bounded slice of a file's content, for the agent's read_file tool. */
export function readSlice(
  file: UploadedFile,
  extract: FileExtract,
  opts: { pages?: string; sheet?: string; offset?: number; limit?: number },
) {
  if (extract.kind === "image") {
    return {
      file: file.name,
      kind: "image",
      mimeType: file.mimeType,
      note: "No text extract for images. Use get_file_link and inspect the screenshot (OCR / vision) to read holdings.",
    };
  }
  if (extract.kind === "pdf") {
    const budget = 30_000;
    const requested = parsePages(opts.pages, extract.pages.length);
    if (requested === null) return { error: 'pages must look like "1-3,5"' };
    const order = requested ?? extract.pages.map((_, i) => i + 1);
    const out: { page: number; text: string }[] = [];
    let used = 0;
    let next: number | undefined;
    for (const p of order) {
      const text = extract.pages[p - 1] ?? "";
      if (out.length && used + text.length > budget) {
        next = p;
        break;
      }
      out.push({ page: p, text: text.slice(0, budget) });
      used += text.length;
    }
    return {
      file: file.name,
      total_pages: file.pages ?? extract.pages.length,
      pages: out,
      ...(next ? { next_pages: `${next}-${order[order.length - 1]}` } : {}),
      ...(file.truncated ? { note: "Only the first part of this PDF's text was extracted." } : {}),
    };
  }
  const sheet = opts.sheet ? extract.sheets.find((s) => s.name === opts.sheet) : extract.sheets[0];
  if (!sheet) return { error: `No sheet named ${opts.sheet}. Sheets: ${extract.sheets.map((s) => s.name).join(", ")}` };
  const offset = Math.max(1, Math.floor(Number(opts.offset) || 1));
  const limit = Math.min(500, Math.max(1, Math.floor(Number(opts.limit) || 100)));
  const rows = sheet.rows.slice(offset, offset + limit);
  const end = offset + rows.length;
  return {
    file: file.name,
    sheet: sheet.name,
    sheets: extract.sheets.map((s) => s.name),
    header: sheet.rows[0] ?? [],
    rows,
    offset,
    total_rows: Math.max(0, sheet.rows.length - 1),
    ...(end < sheet.rows.length ? { next_offset: end } : {}),
  };
}

/** A short preview for the prompt: first pages, or the first rows of each sheet as CSV. */
export function fileExcerpt(extract: FileExtract, maxChars: number) {
  if (maxChars <= 0) return "";
  if (extract.kind === "image") return "(image attachment — use get_file_link to analyse)";
  let out = "";
  if (extract.kind === "pdf") {
    for (const [i, text] of extract.pages.entries()) {
      const block = `[page ${i + 1}]\n${text}\n`;
      if (out.length + block.length > maxChars) {
        out += block.slice(0, Math.max(0, maxChars - out.length));
        return `${out}… [more in the file]`;
      }
      out += block;
    }
    return out.trim();
  }
  for (const sheet of extract.sheets) {
    let block = extract.sheets.length > 1 ? `[sheet ${sheet.name}]\n` : "";
    for (const row of sheet.rows) {
      const line = `${row.map(csvCell).join(",")}\n`;
      if (out.length + block.length + line.length > maxChars) return `${out}${block}… [more rows in the file]`;
      block += line;
    }
    out += block;
  }
  return out.trim();
}
