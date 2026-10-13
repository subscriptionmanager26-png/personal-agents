import { apiError, decodeParam, requireApiUser } from "@/lib/api-auth";
import { deleteFile, fileView, getFile } from "@/lib/files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string; fileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { userId, fileId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  const file = await getFile(auth.user.id, decodeParam(fileId));
  if (!file) return apiError(404, "file_not_found", "File not found.");
  return Response.json({ file: fileView(file) });
}

export async function DELETE(request: Request, { params }: Params) {
  const { userId, fileId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  if (!(await deleteFile(auth.user.id, decodeParam(fileId)))) return apiError(404, "file_not_found", "File not found.");
  return new Response(null, { status: 204 });
}
