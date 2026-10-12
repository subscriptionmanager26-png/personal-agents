import { randomId, sha256 } from "@/lib/crypto";
import { getStore, updateStore } from "@/lib/store";
import type {
  MembershipStatus,
  PersonalUser,
  SuggestedConnection,
  Workspace,
  WorkspaceSkill,
} from "@/lib/types";
import { appendAudit, publicUser } from "@/lib/users";

const RESERVED_SLUGS = new Set(["app", "api", "join", "admin", "new", "www"]);

export function slugify(input: string, max = 40) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export async function getWorkspace(id: string | undefined) {
  if (!id) return undefined;
  const store = await getStore();
  return store.workspaces[id];
}

export async function getWorkspaceBySlug(slug: string) {
  const store = await getStore();
  return Object.values(store.workspaces).find((w) => w.slug === slug);
}

export async function createWorkspace(
  owner: PersonalUser,
  input: { name: string; slug?: string },
): Promise<{ workspace: Workspace } | { error: string }> {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { error: "Workspace name is required." } as const;
  const slug = slugify(input.slug?.trim() || name);
  if (slug.length < 3 || RESERVED_SLUGS.has(slug)) {
    return { error: "Choose a link name with at least 3 letters or numbers." } as const;
  }
  if (owner.workspaceId) return { error: "You already belong to a workspace." } as const;

  const now = new Date().toISOString();
  const outcome = await updateStore((store) => {
    if (Object.values(store.workspaces).some((w) => w.slug === slug)) {
      return { error: "That link name is taken." } as const;
    }
    const user = store.users[owner.id];
    if (!user || user.workspaceId) return { error: "You already belong to a workspace." } as const;
    const workspace: Workspace = {
      id: randomId("ws"),
      slug,
      name,
      ownerUserId: owner.id,
      instructions: "",
      memoryGuidance: "",
      skills: [],
      suggestedConnections: [],
      createdAt: now,
      updatedAt: now,
    };
    store.workspaces[workspace.id] = workspace;
    Object.assign(user, {
      workspaceId: workspace.id,
      role: "owner",
      membershipStatus: "active",
      updatedAt: now,
    });
    return { workspace };
  });
  if ("workspace" in outcome) {
    await appendAudit({ ownerUserId: owner.id, type: "workspace.create", detail: `Created ${slug}` });
  }
  return outcome;
}

/** Applies `fn` only when `ownerUserId` owns the workspace. */
async function mutateOwnedWorkspace<T>(
  ownerUserId: string,
  workspaceId: string,
  fn: (workspace: Workspace) => T,
): Promise<T | undefined> {
  return updateStore((store) => {
    const workspace = store.workspaces[workspaceId];
    if (!workspace || workspace.ownerUserId !== ownerUserId) return undefined;
    const result = fn(workspace);
    workspace.updatedAt = new Date().toISOString();
    return result;
  });
}

export async function updateWorkspaceSettings(
  ownerUserId: string,
  workspaceId: string,
  patch: { name?: string; instructions?: string; memoryGuidance?: string },
) {
  return mutateOwnedWorkspace(ownerUserId, workspaceId, (w) => {
    if (patch.name?.trim()) w.name = patch.name.trim().slice(0, 80);
    if (patch.instructions !== undefined) w.instructions = patch.instructions.trim().slice(0, 8000);
    if (patch.memoryGuidance !== undefined) w.memoryGuidance = patch.memoryGuidance.trim().slice(0, 4000);
    return w;
  });
}

export async function upsertSkill(
  ownerUserId: string,
  workspaceId: string,
  input: { id?: string; name: string; description: string; content: string },
) {
  const name = input.name.trim().slice(0, 80);
  const description = input.description.trim().slice(0, 300);
  const content = input.content.replace(/\r\n/g, "\n").trim().slice(0, 60_000);
  if (!name || !content) return { error: "Name and skill instructions are required." } as const;

  const result = await mutateOwnedWorkspace(ownerUserId, workspaceId, (w) => {
    const now = new Date().toISOString();
    const existing = input.id ? w.skills.find((s) => s.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, { name, description, content, updatedAt: now });
      return existing;
    }
    let slug = slugify(name) || "skill";
    for (let n = 2; w.skills.some((s) => s.slug === slug); n += 1) slug = `${slugify(name)}-${n}`;
    const skill: WorkspaceSkill = { id: randomId("skill"), slug, name, description, content, updatedAt: now };
    w.skills.push(skill);
    return skill;
  });
  return result ? ({ skill: result } as const) : ({ error: "Workspace not found." } as const);
}

export async function deleteSkill(ownerUserId: string, workspaceId: string, skillId: string) {
  return mutateOwnedWorkspace(ownerUserId, workspaceId, (w) => {
    w.skills = w.skills.filter((s) => s.id !== skillId);
    return true;
  });
}

export async function addSuggestedConnection(
  ownerUserId: string,
  workspaceId: string,
  input: { name: string; url: string; description?: string; authHeader?: string },
) {
  const url = normalizeMcpUrl(input.url);
  const name = input.name.trim().slice(0, 60);
  if (!url || !name) return undefined;
  return mutateOwnedWorkspace(ownerUserId, workspaceId, (w) => {
    const item: SuggestedConnection = {
      id: randomId("sugg"),
      name,
      url,
      description: input.description?.trim().slice(0, 300) || undefined,
      authHeader: input.authHeader?.trim().slice(0, 60) || undefined,
    };
    w.suggestedConnections.push(item);
    return item;
  });
}

export async function deleteSuggestedConnection(ownerUserId: string, workspaceId: string, id: string) {
  return mutateOwnedWorkspace(ownerUserId, workspaceId, (w) => {
    w.suggestedConnections = w.suggestedConnections.filter((c) => c.id !== id);
    return true;
  });
}

export function normalizeMcpUrl(raw: string) {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function listClients(ownerUserId: string, workspaceId: string) {
  const store = await getStore();
  const workspace = store.workspaces[workspaceId];
  if (!workspace || workspace.ownerUserId !== ownerUserId) return [];
  return Object.values(store.users)
    .filter((u) => u.workspaceId === workspaceId && u.role === "client")
    .map(publicUser)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Returns the client only when it belongs to a workspace owned by `ownerUserId`. */
export async function getClientForOwner(ownerUserId: string, clientId: string) {
  const store = await getStore();
  const client = store.users[clientId];
  if (!client || client.role !== "client" || !client.workspaceId) return undefined;
  const workspace = store.workspaces[client.workspaceId];
  if (!workspace || workspace.ownerUserId !== ownerUserId) return undefined;
  return publicUser(client);
}

export async function setClientStatus(ownerUserId: string, clientId: string, status: MembershipStatus) {
  const ok = await updateStore((store) => {
    const client = store.users[clientId];
    if (!client || client.role !== "client" || !client.workspaceId) return false;
    const workspace = store.workspaces[client.workspaceId];
    if (!workspace || workspace.ownerUserId !== ownerUserId) return false;
    client.membershipStatus = status;
    client.updatedAt = new Date().toISOString();
    return true;
  });
  if (ok) {
    await appendAudit({ ownerUserId, type: `client.${status}`, detail: `Set ${clientId} to ${status}` });
  }
  return ok;
}

export function canUseAgent(user: Pick<PersonalUser, "workspaceId" | "role" | "membershipStatus"> | undefined) {
  if (!user?.workspaceId) return false;
  if (user.role === "owner") return true;
  return user.role === "client" && user.membershipStatus === "active";
}

export function skillsHash(workspace: Workspace | undefined) {
  if (!workspace?.skills.length) return "none";
  const material = workspace.skills
    .map((s) => `${s.slug}\n${s.name}\n${s.description}\n${s.content}`)
    .sort()
    .join("\n\u0000\n");
  return sha256(material).toString("hex").slice(0, 16);
}
