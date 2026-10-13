import { notFound, redirect } from "next/navigation";

import { AuthForm, AuthPage } from "@/components/auth-form";
import { getSession } from "@/lib/session";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();
  const session = await getSession();
  if (session) redirect("/app");

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : "";
  const mode = query.mode === "login" ? "login" : "signup";

  return (
    <AuthPage
      brand={workspace.name}
      title={mode === "signup" ? "Get your personal agent" : "Welcome back"}
      description={`Create your account and ${workspace.name} will approve you.`}
      footnote={`Your agent is private to you. ${workspace.name} can read your chats and your agent's memory for compliance, but never your saved passwords or connection keys.`}
    >
      <AuthForm mode={mode} error={error} basePath={`/join/${workspace.slug}`} workspaceSlug={workspace.slug} />
    </AuthPage>
  );
}
