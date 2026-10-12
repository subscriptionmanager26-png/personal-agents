import { apiError, decodeParam, publicApiUser, readJson, requireApiUser, requireCompany } from "@/lib/api-auth";
import { deactivateApiUser, isValidExternalId, upsertApiUser } from "@/lib/company";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  return Response.json({ user: publicApiUser(auth.user) });
}

/** Create or update the user's agent. Idempotent; also re-enables a disabled user. */
export async function PUT(request: Request, { params }: Params) {
  const auth = await requireCompany(request);
  if ("response" in auth) return auth.response;
  const externalId = decodeParam((await params).userId);
  if (!isValidExternalId(externalId)) {
    return apiError(400, "invalid_user_id", "User ids are 1-128 characters: letters, digits, . _ : @ -");
  }
  const body = (await readJson(request)) ?? {};
  const result = await upsertApiUser(auth.workspace, externalId, {
    name: typeof body.name === "string" ? body.name : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
  });
  if (!result) return apiError(409, "conflict", "That user id cannot be used.");
  return Response.json({ user: publicApiUser(result.user) }, { status: result.created ? 201 : 200 });
}

/** Disable the user's agent. History and memory are kept; PUT re-enables it. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireApiUser(request, (await params).userId);
  if ("response" in auth) return auth.response;
  await deactivateApiUser(auth.workspace, auth.externalId);
  return new Response(null, { status: 204 });
}
