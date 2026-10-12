import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";
import { canUseAgent, getWorkspace } from "@/lib/workspaces";

/** Signed-in user plus their workspace; undefined fields when not set up yet. */
export async function getViewer() {
  const session = await getSession();
  if (!session) return undefined;
  const user = await getUser(session.id);
  if (!user) return undefined;
  const workspace = await getWorkspace(user.workspaceId);
  return { session, user, workspace, isOwner: user.role === "owner" && workspace?.ownerUserId === user.id };
}

/** For owner-only pages and routes; anyone else is sent back to chat. */
export async function requireOwner() {
  const viewer = await getViewer();
  if (!viewer) redirect("/");
  if (!viewer.isOwner || !viewer.workspace) redirect("/app/chat");
  return { ...viewer, workspace: viewer.workspace };
}

/** For pages and routes that need a usable agent (owner, or approved client). */
export async function requireAgentUser() {
  const viewer = await getViewer();
  if (!viewer) redirect("/");
  if (!canUseAgent(viewer.user)) redirect("/app");
  return viewer;
}
