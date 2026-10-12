export type ToolKind = "terminal" | "file" | "browser" | "search" | "mcp" | "vault" | "other";

export type TraceTool = {
  callId: string;
  name: string;
  kind: ToolKind;
  status: "running" | "completed";
  title: string;
  args?: unknown;
  result?: unknown;
  truncated?: { args?: true; result?: true };
  terminal?: { command: string; output?: string; exitCode?: number };
  file?: { path: string; action: string };
};

/** Wire format sent from /api/jobs/[id]/stream to the browser. */
export type TraceEvent =
  | { type: "status"; status: string }
  | { type: "thinking"; text: string }
  | { type: "assistant"; text: string }
  | ({ type: "tool" } & TraceTool)
  | { type: "result"; status: string; text?: string; durationMs?: number }
  | { type: "error"; message: string }
  | { type: "expired" }
  | { type: "done" };

export type ArtifactItem = {
  path: string;
  sizeBytes?: number;
  updatedAt?: string;
  kind: "image" | "video" | "text" | "other";
};

export function artifactKind(path: string): ArtifactItem["kind"] {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["md", "txt", "log", "json", "csv", "html"].includes(ext)) return "text";
  return "other";
}
