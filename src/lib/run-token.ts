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

export async function verifyMemoryToken(token: string) {
  const key = new TextEncoder().encode(getConfig().sessionSecret);
  const { payload } = await jwtVerify(token, key);
  if (payload.purpose !== PURPOSE) throw new Error("Invalid token");
  if (typeof payload.ownerUserId !== "string" || typeof payload.jobId !== "string") {
    throw new Error("Invalid token");
  }
  return { ownerUserId: payload.ownerUserId, jobId: payload.jobId };
}
