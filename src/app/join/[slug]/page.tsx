import { notFound, redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
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
    <main className="relative flex min-h-full flex-1 flex-col">
      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-12 px-6 py-16 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <p className="font-heading text-5xl tracking-tight text-foreground">{workspace.name}</p>
          <h1 className="mt-4 text-xl text-muted-foreground">Your personal agent from {workspace.name}.</h1>
          <p className="mt-4 max-w-lg text-sm text-muted-foreground">
            Create your account, and {workspace.name} will approve you. Your agent is private to you:
            no other client&apos;s agent can see your chats, memory or connected accounts.{" "}
            {workspace.name} can read your chats and your agent&apos;s memory for compliance, but never
            your saved passwords or connection keys.
          </p>
        </div>
        <AuthForm mode={mode} error={error} basePath={`/join/${workspace.slug}`} workspaceSlug={workspace.slug} />
      </div>
    </main>
  );
}
