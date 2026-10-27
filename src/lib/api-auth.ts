import { apiUserId, authenticateApiKey, getApiUser, isValidExternalId } from "@/lib/company";
import { isStoreReadError } from "@/lib/store-errors";
import type { PersonalUser, Workspace } from "@/lib/types";

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export function decodeParam(raw: string) {
  try {
    return raw.includes("%") ? decodeURIComponent(raw) : raw;
  } catch {
    return raw;
  }
}

/** Authenticates the company's API key. */
export async function requireCompany(request: Request): Promise<{ workspace: Workspace } | { response: Response }> {
  try {
    const workspace = await authenticateApiKey(request.headers.get("authorization"));
    if (!workspace) return { response: apiError(401, "unauthorized", "Missing or invalid API key.") };
    return { workspace };
  } catch (error) {
    if (isStoreReadError(error)) {
      return { response: apiError(503, error.code, error.message) };
    }
    throw error;
  }
}

/** Authenticates the API key and resolves the company's user by its own id. */
export async function requireApiUser(
  request: Request,
  rawUserId: string,
): Promise<{ workspace: Workspace; user: PersonalUser; externalId: string } | { response: Response }> {
  const auth = await requireCompany(request);
  if ("response" in auth) return auth;
  const externalId = decodeParam(rawUserId);
  if (!isValidExternalId(externalId)) {
    return { response: apiError(400, "invalid_user_id", "User ids are 1-128 characters: letters, digits, . _ : @ -") };
  }
  const user = await getApiUser(auth.workspace, externalId);
  if (!user) return { response: apiError(404, "user_not_found", "Create the user with PUT /api/v1/users/{userId} first.") };
  return { workspace: auth.workspace, user, externalId };
}

/**
 * Threads list hot path: API key (+ cache) and derive owner id without loading the user blob.
 * Sync on login already created the user; index read does not need the profile row.
 */
export async function requireApiUserForThreads(
  request: Request,
  rawUserId: string,
): Promise<{ workspace: Workspace; ownerUserId: string; externalId: string } | { response: Response }> {
  const auth = await requireCompany(request);
  if ("response" in auth) return auth;
  const externalId = decodeParam(rawUserId);
  if (!isValidExternalId(externalId)) {
    return { response: apiError(400, "invalid_user_id", "User ids are 1-128 characters: letters, digits, . _ : @ -") };
  }
  return {
    workspace: auth.workspace,
    ownerUserId: apiUserId(auth.workspace.id, externalId),
    externalId,
  };
}

export async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function publicApiUser(user: PersonalUser) {
  return {
    id: user.externalId,
    name: user.displayName ?? null,
    email: user.email ?? null,
    status: user.membershipStatus === "active" ? "active" : "disabled",
    createdAt: user.createdAt,
  };
}
