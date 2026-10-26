export const dynamic = "force-dynamic";

/** Public build marker for ops (no secrets). */
export async function GET() {
  return Response.json({
    ok: true,
    reconcileOnRead: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  });
}
