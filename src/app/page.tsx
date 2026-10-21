import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthForm, AuthPage } from "@/components/auth-form";
import { SaffronLanding } from "@/components/saffron/saffron-landing";
import { getSession } from "@/lib/session";
import { isAdminHost, isSaffronHost } from "@/lib/site-mode";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host");
  if (!isSaffronHost(host)) {
    return {};
  }
  return {
    title: "SaffronAI",
    description: "Hire and train AI employees. Plug-and-play infrastructure for AI-native websites.",
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const host = (await headers()).get("host");
  if (isSaffronHost(host)) {
    return <SaffronLanding />;
  }

  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "saffron") {
    return <SaffronLanding />;
  }

  const session = await getSession();
  if (session) redirect("/app");

  const admin = isAdminHost(host);
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
