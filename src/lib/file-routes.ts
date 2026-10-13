import { apiError } from "@/lib/api-auth";
import { fileView, MAX_FILE_BYTES, unlockFile, uploadFile } from "@/lib/files";
import type { PersonalUser } from "@/lib/types";
import { canUseAgent } from "@/lib/workspaces";

const CODES: Record<number, string> = {
  400: "invalid_file",
  404: "file_not_found",
  409: "file_conflict",
  413: "file_too_large",
  415: "unsupported_file_type",
  422: "unreadable_file",
  503: "uploads_unavailable",
};

/** multipart/form-data with one `file` field. */
export async function handleUpload(request: Request, user: PersonalUser) {
  if (!canUseAgent(user)) return apiError(403, "user_disabled", "This user's agent is not available.");
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_FILE_BYTES + 64 * 1024) {
    return apiError(413, CODES[413], `Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, CODES[400], "Send multipart/form-data with a `file` field.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, CODES[400], "Send multipart/form-data with a `file` field.");
  const result = await uploadFile({
    ownerUserId: user.id,
    name: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  if ("error" in result) return apiError(result.code, CODES[result.code], result.error);
  return Response.json({ file: fileView(result.file) }, { status: 201 });
}

/** JSON `{ password }` for a password-protected PDF. */
export async function handleUnlock(request: Request, user: PersonalUser, fileId: string) {
  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // handled below
  }
  const result = await unlockFile(user.id, fileId, password);
  if ("error" in result) {
    const code = result.code === 422 && /password/i.test(result.error) ? "wrong_password" : CODES[result.code];
    return apiError(result.code, code, result.error);
  }
  return Response.json({ file: fileView(result.file) });
}
