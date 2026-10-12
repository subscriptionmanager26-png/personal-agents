import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
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
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklab,var(--chart-2)_35%,transparent),transparent_55%),radial-gradient(ellipse_at_bottom_right,color-mix(in_oklab,var(--chart-4)_28%,transparent),transparent_50%),linear-gradient(180deg,var(--background),color-mix(in_oklab,var(--background),var(--muted)_40%))]"
      />
      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-12 px-6 py-16 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <p className="font-heading text-5xl tracking-tight text-foreground sm:text-6xl">Personal Agents</p>
          <h1 className="mt-4 text-xl text-muted-foreground sm:text-2xl">
            Give every client their own AI agent, trained on your playbooks.
          </h1>
          <p className="mt-4 max-w-lg text-sm text-muted-foreground">
            Write the skills once. Each client gets a private agent with its own memory and
            connected accounts, and no agent can see another client&apos;s data. Clients join
            through your signup link and start once you approve them.
          </p>
        </div>
        <AuthForm mode={mode} error={error} basePath="/" signupLabel="Create a business account" />
      </div>
    </main>
  );
}
