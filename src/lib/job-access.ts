import { getJob } from "@/lib/jobs";
import { getSession } from "@/lib/session";

/** Returns the job only when it belongs to the signed-in user. */
export async function getOwnedJob(jobId: string) {
  const session = await getSession();
  if (!session) return undefined;
  const job = await getJob(jobId);
  if (!job || job.ownerUserId !== session.id) return undefined;
  return job;
}

export function isSafeArtifactPath(path: string) {
  return (
    path.startsWith("artifacts/") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.includes("//")
  );
}
