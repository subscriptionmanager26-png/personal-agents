import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import type { SessionUser } from "@/lib/types";

export const SESSION_COOKIE = "pa_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secretKey() {
  return new TextEncoder().encode(getConfig().sessionSecret);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  };
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

export async function readSessionToken(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.id !== "string") return null;
    return {
      id: payload.id,
      email: typeof payload.email === "string" ? payload.email : undefined,
      displayName:
        typeof payload.displayName === "string"
          ? payload.displayName
          : undefined,
      avatarUrl:
        typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined,
      slackTeamId:
        typeof payload.slackTeamId === "string"
          ? payload.slackTeamId
          : undefined,
      slackUserId:
        typeof payload.slackUserId === "string"
          ? payload.slackUserId
          : undefined,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser) {
  const token = await createSessionToken(user);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  return token;
}

export async function redirectWithSession(user: SessionUser, url: string) {
  const token = await createSessionToken(user);
  try {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  } catch {
    // Response Set-Cookie below is authoritative for the browser.
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export function sessionFromUser(user: {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  slackTeamId?: string;
  slackUserId?: string;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    slackTeamId: user.slackTeamId,
    slackUserId: user.slackUserId,
  };
}
