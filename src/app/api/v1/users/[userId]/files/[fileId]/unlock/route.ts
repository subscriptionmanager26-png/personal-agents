import { decodeParam, requireApiUser } from "@/lib/api-auth";
import { handleUnlock } from "@/lib/file-routes";

export const dynamic = "force-dynamic";

/** Opens a password-protected PDF (e.g. a CAS statement). The password is not stored. */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string; fileId: string }> }) {
  const { userId, fileId } = await params;
  const auth = await requireApiUser(request, userId);
  if ("response" in auth) return auth.response;
  return handleUnlock(request, auth.user, decodeParam(fileId));
}
