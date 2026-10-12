import { apiError, publicApiUser } from "@/lib/api-auth";
import { upsertApiUser } from "@/lib/company";
import { requireOwner } from "@/lib/viewer";

export async function POST(request: Request) {
  const { workspace } = await requireOwner();
  const body = (await request.json().catch(() => ({}))) as { externalId?: string; name?: string };
  const result = await upsertApiUser(workspace, String(body.externalId ?? "").trim(), { name: body.name });
  if (!result) return apiError(400, "invalid_user_id", "User ids are 1-128 characters: letters, digits, . _ : @ -");
  return Response.json({ user: publicApiUser(result.user) });
}
