import { createApiKey } from "@/lib/company";
import { requireOwner } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const body = (await request.json().catch(() => ({}))) as { label?: string };
  const created = await createApiKey(user.id, workspace.id, String(body.label ?? ""));
  if (!created) return Response.json({ error: "Could not create key" }, { status: 400 });
  return Response.json({ key: created.key }, { headers: { "Cache-Control": "no-store" } });
}
