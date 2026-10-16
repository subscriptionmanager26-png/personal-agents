import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthForm, AuthPage } from "@/components/auth-form";
import { getSession } from "@/lib/session";
import { isAdminHost } from "@/lib/site-mode";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session) redirect("/app");

  const host = (await headers()).get("host");
  const admin = isAdminHost(host);
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const mode = admin || params.mode !== "signup" ? "login" : "signup";

  return (
    <AuthPage
      brand={admin ? "Pocketedge Agents" : "Personal Agents"}
      title={admin ? "Pocketedge admin" : mode === "signup" ? "Set up your business" : "Welcome back"}
      description={
        admin
          ? "Manage Pocketedge instructions, skills, API keys, and agent runtime."
          : "Give every client their own AI agent, trained on your playbooks."
      }
      footnote={
        admin
          ? "End users sign in on pocketedge.in and chat on Pramaan. This console is for Pocketedge staff only."
          : "Each client gets a private agent with its own memory and connected accounts. No agent can see another client's data."
      }
    >
      <AuthForm
        mode={mode}
        error={error}
        basePath="/"
        signupLabel="Create account"
        hideSignup={admin}
      />
    </AuthPage>
  );
}
