import { listArtifacts } from "@/lib/cursor-api";
import { listJobsForUser } from "@/lib/jobs";
import { isMockRunId, MOCK_ARTIFACTS } from "@/lib/mock-trace";
import { runtimeForUserId } from "@/lib/runtime";
import { artifactKind, type ArtifactItem } from "@/lib/trace-types";
import type { Job } from "@/lib/types";

/** Files the agent wrote for this message (between send and the next message on the same agent). */
export async function listMessageArtifacts(job: Job): Promise<ArtifactItem[]> {
  if (isMockRunId(job.cursorRunId)) {
    return job.status === "replied"
      ? MOCK_ARTIFACTS.map((a) => ({ ...a, kind: artifactKind(a.path) }))
      : [];
  }
  if (!job.cursorAgentId) return [];

  const since = Date.parse(job.createdAt);
  const next = (await listJobsForUser(job.ownerUserId, 1000))
    .filter((j) => j.cursorAgentId === job.cursorAgentId && Date.parse(j.createdAt) > since)
    .reduce((min, j) => Math.min(min, Date.parse(j.createdAt)), Infinity);

  const key = (await runtimeForUserId(job.ownerUserId)).cursorApiKey;
  return (await listArtifacts(key, job.cursorAgentId))
    .filter((a) => {
      if (!a.updatedAt) return next === Infinity;
      const at = Date.parse(a.updatedAt);
      return at >= since && at < next;
    })
    .map((a) => ({ ...a, kind: artifactKind(a.path) }));
}
