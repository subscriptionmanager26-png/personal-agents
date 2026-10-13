import { getFile, readRaw } from "@/lib/files";
import { verifyFileToken } from "@/lib/run-token";
import { getUser } from "@/lib/users";
import { canUseAgent } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

/** Raw file for the agent's VM, via the short-lived link from get_file_link. */
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const token = new URL(request.url).searchParams.get("t") || "";
  let claims;
  try {
    claims = await verifyFileToken(token);
  } catch {
    return new Response("Link expired or invalid", { status: 401 });
  }
  if (claims.fileId !== fileId || !canUseAgent(await getUser(claims.ownerUserId))) {
    return new Response("Link expired or invalid", { status: 401 });
  }
  const file = await getFile(claims.ownerUserId, fileId);
  const bytes = file ? await readRaw(file) : undefined;
  if (!file || !bytes) return new Response("Not found", { status: 404 });
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
