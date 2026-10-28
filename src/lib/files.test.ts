import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.PERSONAL_AGENTS_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "pa-files-test-"));
process.env.SESSION_SECRET = "test-session-secret";
process.env.VAULT_MASTER_KEY = "test-vault-master";
process.env.CURSOR_API_KEY = "";
process.env.PUBLIC_URL = "https://agents.example.com";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";
process.env.BLOB_READ_WRITE_TOKEN = "";
process.env.BLOB_STORE_ID = "";

const fixture = (name: string) => readFileSync(path.join(__dirname, "test-fixtures", name));
const PASSWORD = "ABCDE1234F";

async function setup() {
  const { registerUserWithEmail } = await import("@/lib/users");
  const { createWorkspace } = await import("@/lib/workspaces");
  const { upsertApiUser } = await import("@/lib/company");
  const reg = await registerUserWithEmail({ email: "ops@files.example", password: "password-123" });
  assert.ok("user" in reg);
  const created = await createWorkspace(reg.user, { name: "Files Co" });
  assert.ok("workspace" in created);
  const priya = (await upsertApiUser(created.workspace, "priya", {}))!.user;
  const rahul = (await upsertApiUser(created.workspace, "rahul", {}))!.user;
  return { priya, rahul };
}

let world: Awaited<ReturnType<typeof setup>> | undefined;
const users = async () => (world ??= await setup());

async function xlsxBuffer() {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["Symbol", "Qty", "LTP", "Bought on"],
      ["INFY", 10, 1522.5, new Date(Date.UTC(2024, 3, 1))],
      ["TCS", 4, 4110, new Date(Date.UTC(2023, 0, 15))],
    ]),
    "Holdings",
  );
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Note"], ["hello"]]), "Notes");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

test("file types are decided by content, not just the extension", async () => {
  const { detectFile } = await import("@/lib/files");
  const pdf = fixture("statement.pdf");
  assert.deepEqual(detectFile("a.pdf", pdf), { kind: "pdf", mimeType: "application/pdf" });
  assert.equal((detectFile("a.PDF", pdf) as { kind: string }).kind, "pdf");
  assert.ok("error" in detectFile("a.docx", pdf));
  assert.ok("error" in detectFile("a.pdf", Buffer.from("MZ\x90\x00 not a pdf")));
  assert.ok("error" in detectFile("a.csv", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])));
  assert.ok("error" in detectFile("a.csv", Buffer.from("a,b\n1,\u0000")));
  assert.ok("error" in detectFile("a.xlsx", Buffer.from("symbol,qty\nINFY,1")));
  assert.equal((detectFile("a.xlsx", await xlsxBuffer()) as { kind: string }).kind, "xlsx");
  assert.equal((detectFile("a.csv", Buffer.from("a,b\n1,2")) as { kind: string }).kind, "csv");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
  assert.deepEqual(detectFile("holdings.png", png), { kind: "image", mimeType: "image/png" });
  assert.ok("error" in detectFile("holdings.png", Buffer.from("not-a-png")));
});

test("CSV, Excel and PDF uploads are extracted and readable in bounded slices", async () => {
  const { uploadFile, readExtract, readSlice, fileExcerpt, describeFile } = await import("@/lib/files");
  const { priya } = await users();

  const csv = await uploadFile({
    ownerUserId: priya.id,
    name: "../../holdings.csv",
    bytes: Buffer.from('\uFEFFSymbol,Qty,Note\nINFY,10,"long, term"\nTCS,4,\n\n'),
  });
  assert.ok("file" in csv);
  assert.equal(csv.file.name, "holdings.csv", "path parts are stripped");
  assert.deepEqual(csv.file.sheets, [{ name: "Sheet1", rows: 3, columns: 3, header: ["Symbol", "Qty", "Note"] }]);
  const csvSlice = readSlice(csv.file, (await readExtract(csv.file))!, {});
  assert.deepEqual(csvSlice, {
    file: "holdings.csv",
    sheet: "Sheet1",
    sheets: ["Sheet1"],
    header: ["Symbol", "Qty", "Note"],
    rows: [["INFY", "10", "long, term"], ["TCS", "4"]],
    offset: 1,
    total_rows: 2,
  });

  const xlsx = await uploadFile({ ownerUserId: priya.id, name: "portfolio.xlsx", bytes: await xlsxBuffer() });
  assert.ok("file" in xlsx);
  assert.equal(xlsx.file.kind, "xlsx");
  assert.deepEqual(xlsx.file.sheets?.map((s) => [s.name, s.rows]), [["Holdings", 3], ["Notes", 2]]);
  const sheet = readSlice(xlsx.file, (await readExtract(xlsx.file))!, { offset: 2, limit: 1 });
  assert.ok("rows" in sheet);
  assert.deepEqual(sheet.rows, [["TCS", 4, 4110, "2023-01-15"]]);
  assert.equal(sheet.next_offset, undefined);
  const notes = readSlice(xlsx.file, (await readExtract(xlsx.file))!, { sheet: "Notes" });
  assert.ok("rows" in notes && notes.rows[0][0] === "hello");
  assert.ok("error" in readSlice(xlsx.file, (await readExtract(xlsx.file))!, { sheet: "Nope" }));
  assert.match(describeFile(xlsx.file), /"Holdings" 3 rows × 4 cols/);

  const pdf = await uploadFile({ ownerUserId: priya.id, name: "cas.pdf", bytes: fixture("statement.pdf") });
  assert.ok("file" in pdf);
  assert.equal(pdf.file.status, "ready");
  assert.equal(pdf.file.pages, 2);
  const extract = (await readExtract(pdf.file))!;
  const page2 = readSlice(pdf.file, extract, { pages: "2" });
  assert.ok("pages" in page2);
  assert.deepEqual(page2.pages, [{ page: 2, text: "Total market value Rs 12,34,567" }]);
  assert.ok("error" in readSlice(pdf.file, extract, { pages: "two" }));
  assert.match(fileExcerpt(extract, 10_000), /\[page 1\]\nConsolidated Account Statement/);
  assert.ok(fileExcerpt(extract, 30).length < 60, "excerpt respects its budget");
});

test("password-protected PDFs must be unlocked, and the password is never kept", async () => {
  const { uploadFile, unlockFile, resolveAttachments, readExtract } = await import("@/lib/files");
  const { getStore } = await import("@/lib/store");
  const { priya, rahul } = await users();

  const locked = await uploadFile({ ownerUserId: priya.id, name: "cas-locked.pdf", bytes: fixture("statement-locked.pdf") });
  assert.ok("file" in locked);
  assert.equal(locked.file.status, "needs_password");
  assert.equal(await readExtract(locked.file), undefined);
  const blocked = await resolveAttachments(priya.id, [locked.file.id]);
  assert.ok("error" in blocked && /password/.test(blocked.error));

  const wrong = await unlockFile(priya.id, locked.file.id, "wrong");
  assert.ok("error" in wrong && wrong.code === 422);
  const stolen = await unlockFile(rahul.id, locked.file.id, PASSWORD);
  assert.ok("error" in stolen && stolen.code === 404, "another user cannot unlock it");

  const opened = await unlockFile(priya.id, locked.file.id, PASSWORD);
  assert.ok("file" in opened && opened.file.status === "ready" && opened.file.pages === 2);
  const extract = await readExtract(opened.file);
  assert.ok(extract?.kind === "pdf" && extract.pages[1].includes("12,34,567"));
  assert.ok(!JSON.stringify(await getStore()).includes(PASSWORD));
  const again = await unlockFile(priya.id, locked.file.id, PASSWORD);
  assert.ok("error" in again && again.code === 409);
});

test("uploads enforce size, type and per-message limits", async () => {
  const { uploadFile, resolveAttachments, MAX_FILE_BYTES, listFiles } = await import("@/lib/files");
  const { priya, rahul } = await users();

  const big = await uploadFile({ ownerUserId: priya.id, name: "big.csv", bytes: Buffer.alloc(MAX_FILE_BYTES + 1, 0x61) });
  assert.ok("error" in big && big.code === 413);
  const exe = await uploadFile({ ownerUserId: priya.id, name: "virus.exe", bytes: Buffer.from("MZ") });
  assert.ok("error" in exe && exe.code === 415);
  const empty = await uploadFile({ ownerUserId: priya.id, name: "empty.csv", bytes: Buffer.alloc(0) });
  assert.ok("error" in empty && empty.code === 400);
  const broken = await uploadFile({ ownerUserId: priya.id, name: "broken.pdf", bytes: Buffer.from("%PDF-1.4 garbage") });
  assert.ok("error" in broken && broken.code === 422);

  const mine = (await listFiles(priya.id)).filter((f) => f.status === "ready").map((f) => f.id);
  assert.ok(mine.length >= 3);
  assert.ok("files" in (await resolveAttachments(priya.id, mine.slice(0, 2))));
  assert.ok("error" in (await resolveAttachments(rahul.id, mine.slice(0, 1))), "cannot attach someone else's file");
  assert.ok("error" in (await resolveAttachments(priya.id, "file_x")));
  assert.ok("error" in (await resolveAttachments(priya.id, Array(6).fill(0).map((_, i) => `f${i}`))));
});

test("the agent reads only its own client's files, and download links are scoped", async () => {
  const { callAgentTool } = await import("@/lib/agent-mcp");
  const { createJob } = await import("@/lib/jobs");
  const { listFiles, deleteFile, getFile } = await import("@/lib/files");
  const { createFileToken } = await import("@/lib/run-token");
  const { GET } = await import("@/app/api/files/[fileId]/download/route");
  const { priya, rahul } = await users();

  const files = await listFiles(priya.id);
  const csv = files.find((f) => f.name === "holdings.csv")!;
  const job = await createJob({
    ownerUserId: priya.id,
    source: "api",
    prompt: "check this",
    attachments: [{ id: csv.id, name: csv.name, kind: csv.kind, size: csv.size }],
  });
  const json = (r: Awaited<ReturnType<typeof callAgentTool>>) => JSON.parse(r!.content[0].text);

  const listed = json(await callAgentTool({ ownerUserId: priya.id, jobId: job.id }, "list_files", {}));
  assert.ok(listed.files.some((f: { id: string; attached_to_this_message: boolean }) => f.id === csv.id && f.attached_to_this_message));
  const read = json(await callAgentTool({ ownerUserId: priya.id, jobId: job.id }, "read_file", { file_id: csv.id }));
  assert.equal(read.rows[0][0], "INFY");

  const rahulJob = await createJob({ ownerUserId: rahul.id, source: "api", prompt: "x" });
  const peek = await callAgentTool({ ownerUserId: rahul.id, jobId: rahulJob.id }, "read_file", { file_id: csv.id });
  assert.equal(peek?.isError, true);
  assert.deepEqual(json(await callAgentTool({ ownerUserId: rahul.id, jobId: rahulJob.id }, "list_files", {})).files, []);

  const link = json(await callAgentTool({ ownerUserId: priya.id, jobId: job.id }, "get_file_link", { file_id: csv.id }));
  const url = new URL(link.url);
  assert.equal(url.origin, "https://agents.example.com");
  const download = (u: URL, fileId: string) => GET(new Request(u), { params: Promise.resolve({ fileId }) });
  const ok = await download(url, csv.id);
  assert.equal(ok.status, 200);
  assert.deepEqual(
    Buffer.from(await ok.arrayBuffer()),
    Buffer.from('\uFEFFSymbol,Qty,Note\nINFY,10,"long, term"\nTCS,4,\n\n'),
    "the original bytes, unchanged",
  );
  assert.match(ok.headers.get("content-disposition") ?? "", /attachment; filename="holdings.csv"/);

  const other = files.find((f) => f.id !== csv.id)!;
  assert.equal((await download(url, other.id)).status, 401, "a link only opens its own file");
  const forged = new URL(`https://x/api/files/${csv.id}/download?t=${await createFileToken({ ownerUserId: rahul.id, fileId: csv.id })}`);
  assert.equal((await download(forged, csv.id)).status, 404, "another user's token finds nothing");
  assert.equal((await download(new URL(`https://x/?t=garbage`), csv.id)).status, 401);

  assert.equal(await deleteFile(rahul.id, csv.id), false);
  assert.equal(await deleteFile(priya.id, csv.id), true);
  assert.equal(await getFile(priya.id, csv.id), undefined);
  assert.equal((await download(url, csv.id)).status, 404);
});

test("attached files appear in the prompt as fenced data with a bounded preview", async () => {
  const { buildPersonalAgentPrompt } = await import("@/lib/prompt");
  const { createJob } = await import("@/lib/jobs");
  const { listFiles } = await import("@/lib/files");
  const { getUser } = await import("@/lib/users");
  const { priya } = await users();

  const xlsx = (await listFiles(priya.id)).find((f) => f.name === "portfolio.xlsx")!;
  const job = await createJob({
    ownerUserId: priya.id,
    source: "api",
    prompt: "review this",
    attachments: [
      { id: xlsx.id, name: xlsx.name, kind: xlsx.kind, size: xlsx.size },
      { id: "file_gone", name: "old.csv", kind: "csv", size: 10 },
    ],
  });
  const user = (await getUser(priya.id))!;
  const withTools = await buildPersonalAgentPrompt(user, job, { agentTools: true, skillsInRepo: false, companyServers: [], connections: [] });
  assert.match(withTools, /## Files attached to this message/);
  assert.match(withTools, new RegExp(`portfolio.xlsx \\(file_id ${xlsx.id}\\)`));
  assert.match(withTools, /<<<file\n\[sheet Holdings\]\nSymbol,Qty,LTP,Bought on\nINFY,10,1522.5,2024-04-01/);
  assert.match(withTools, /old.csv\n\(the client has since deleted this file\)/);
  assert.match(withTools, /read_file/);
  const without = await buildPersonalAgentPrompt(user, job);
  assert.match(without, /Only this preview is available/);
  assert.ok(!without.includes("get_file_link"));
});
