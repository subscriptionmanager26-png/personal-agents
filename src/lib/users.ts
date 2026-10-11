import { randomId } from "@/lib/crypto";
import {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  verifyPassword,
} from "@/lib/password";
import { updateStore, getStore } from "@/lib/store";
import type { AuditEvent, PersonalUser } from "@/lib/types";

export function makeEmailUserId(email: string) {
  return `email:${normalizeEmail(email)}`;
}

export function makeUserId(teamId: string, userId: string) {
  return `slack:${teamId}:${userId}`;
}

export async function getUser(id: string) {
  const store = await getStore();
  const user = store.users[id];
  return user ? publicUser(user) : undefined;
}

async function getUserRaw(id: string) {
  const store = await getStore();
  return store.users[id];
}

export async function listUsers() {
  const store = await getStore();
  return Object.values(store.users)
    .map(publicUser)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findUserByEmail(email: string) {
  return getUserRaw(makeEmailUserId(email));
}

export async function registerUserWithEmail(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ user: PersonalUser } | { error: string }> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { error: "Enter a valid email address." };
  if (input.password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const id = makeEmailUserId(email);
  const existing = await getUserRaw(id);
  if (existing?.passwordHash) {
    return { error: "An account with this email already exists. Sign in instead." };
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  const displayName =
    input.displayName?.trim() || email.split("@")[0] || "Operator";

  const outcome = await updateStore((store) => {
    const prev = store.users[id];
    if (prev?.passwordHash) {
      return { error: "taken" as const };
    }
    const next: PersonalUser = {
      id,
      email,
      passwordHash,
      displayName: prev?.displayName || displayName,
      avatarUrl: prev?.avatarUrl,
      slackTeamId: prev?.slackTeamId,
      slackUserId: prev?.slackUserId,
      agentRepository: prev?.agentRepository,
      agentRef: prev?.agentRef || "main",
      cursorAgentId: prev?.cursorAgentId,
      enabledSkillIds: prev?.enabledSkillIds || [],
      provisionError: prev?.provisionError,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
      lastSeenAt: now,
    };
    store.users[id] = next;
    return { user: next };
  });

  if ("error" in outcome) {
    return { error: "An account with this email already exists. Sign in instead." };
  }

  return { user: publicUser(outcome.user) };
}

export async function authenticateEmailPassword(input: {
  email: string;
  password: string;
}): Promise<{ user: PersonalUser } | { error: string }> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { error: "Enter a valid email address." };
  const user = await findUserByEmail(email);
  if (!user?.passwordHash) {
    return { error: "Invalid email or password." };
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) return { error: "Invalid email or password." };

  const now = new Date().toISOString();
  const updated =
    (await updateUser(user.id, { lastSeenAt: now })) ?? user;
  return { user: publicUser(updated) };
}

/** Strip secrets before returning user objects to callers. */
export function publicUser(user: PersonalUser): PersonalUser {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

export async function upsertUserFromSlack(input: {
  teamId: string;
  userId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}): Promise<PersonalUser> {
  const id = makeUserId(input.teamId, input.userId);
  const now = new Date().toISOString();
  return updateStore((store) => {
    const existing = store.users[id];
    if (existing) {
      existing.displayName = input.displayName || existing.displayName;
      existing.email = input.email || existing.email;
      existing.avatarUrl = input.avatarUrl || existing.avatarUrl;
      existing.slackTeamId = input.teamId;
      existing.slackUserId = input.userId;
      existing.lastSeenAt = now;
      existing.updatedAt = now;
      return publicUser(existing);
    }
    const user: PersonalUser = {
      id,
      slackTeamId: input.teamId,
      slackUserId: input.userId,
      displayName: input.displayName,
      email: input.email,
      avatarUrl: input.avatarUrl,
      agentRef: "main",
      enabledSkillIds: [],
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    store.users[id] = user;
    return publicUser(user);
  });
}

export async function updateUser(
  id: string,
  patch: Partial<PersonalUser>,
): Promise<PersonalUser | undefined> {
  return updateStore((store) => {
    const user = store.users[id];
    if (!user) return undefined;
    Object.assign(user, patch, { updatedAt: new Date().toISOString() });
    return publicUser(user);
  });
}

export async function appendAudit(event: Omit<AuditEvent, "id" | "at">) {
  return updateStore((store) => {
    const row: AuditEvent = {
      id: randomId("audit"),
      at: new Date().toISOString(),
      ...event,
    };
    store.auditEvents.unshift(row);
    store.auditEvents = store.auditEvents.slice(0, 500);
    return row;
  });
}
