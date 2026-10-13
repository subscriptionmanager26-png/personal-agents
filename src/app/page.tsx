import { redirect } from "next/navigation";

import { AuthForm, AuthPage } from "@/components/auth-form";
import { getSession } from "@/lib/session";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session) redirect("/app");

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const mode = params.mode === "signup" ? "signup" : "login";

  return (
    <AuthPage
      brand="Personal Agents"
      title={mode === "signup" ? "Set up your business" : "Welcome back"}
      description="Give every client their own AI agent, trained on your playbooks."
      footnote="Each client gets a private agent with its own memory and connected accounts. No agent can see another client's data."
    >
      <AuthForm mode={mode} error={error} basePath="/" signupLabel="Create account" />
    </AuthPage>
  );
}
