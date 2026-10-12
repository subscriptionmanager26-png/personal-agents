import { ensureSigningSecret } from "@/lib/company";
import { appendAudit } from "@/lib/users";
import { requireOwner } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user, workspace } = await requireOwner();
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const rotate = body.action === "rotate";
  const secret = await ensureSigningSecret(user.id, workspace.id, rotate);
  if (!secret) return Response.json({ error: "Workspace not found" }, { status: 404 });
  if (!rotate) await appendAudit({ ownerUserId: user.id, type: "signing_secret.reveal", detail: workspace.id });
  return Response.json({ secret }, { headers: { "Cache-Control": "no-store" } });
}
