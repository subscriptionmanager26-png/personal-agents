import { requireApiUser } from "@/lib/api-auth";
import { handleUpload } from "@/lib/file-routes";
import { fileView, listFiles } from "@/lib/files";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  return Response.json({ files: (await listFiles(auth.user.id, limit)).map(fileView) });
}

/** Upload a PDF, CSV or Excel file; attach it by id when sending a message. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  return handleUpload(request, auth.user);
}
