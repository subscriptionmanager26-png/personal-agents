import { SignJWT, jwtVerify } from "jose";

import { getConfig } from "@/lib/config";

const PURPOSE = "agent-memory";

/** Per-job credential for the memory MCP; lives only in Cursor-proxied MCP headers. */
export async function createMemoryToken(input: { ownerUserId: string; jobId: string }) {
  const key = new TextEncoder().encode(getConfig().sessionSecret);
  return new SignJWT({ purpose: PURPOSE, ownerUserId: input.ownerUserId, jobId: input.jobId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("3h")
    .sign(key);
}

const FILE_PURPOSE = "file-download";

/** Short-lived link credential so the agent's VM can download one of the client's files. */
export async function createFileToken(input: { ownerUserId: string; fileId: string }) {
  const key = new TextEncoder().encode(getConfig().sessionSecret);
  return new SignJWT({ purpose: FILE_PURPOSE, ownerUserId: input.ownerUserId, fileId: input.fileId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key);
}

export async function verifyFileToken(token: string) {
  const key = new TextEncoder().encode(getConfig().sessionSecret);
  const { payload } = await jwtVerify(token, key);
  if (payload.purpose !== FILE_PURPOSE || typeof payload.ownerUserId !== "string" || typeof payload.fileId !== "string") {
    throw new Error("Invalid token");
  }
  return { ownerUserId: payload.ownerUserId, fileId: payload.fileId };
}

export async function verifyMemoryToken(token: string) {
  const key = new TextEncoder().encode(getConfig().sessionSecret);
  const { payload } = await jwtVerify(token, key);
  if (payload.purpose !== PURPOSE) throw new Error("Invalid token");
  if (typeof payload.ownerUserId !== "string" || typeof payload.jobId !== "string") {
    throw new Error("Invalid token");
  }
  return { ownerUserId: payload.ownerUserId, jobId: payload.jobId };
}
