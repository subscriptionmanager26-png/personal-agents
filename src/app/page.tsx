import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSession } from "@/lib/session";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (session) redirect("/app/chat");

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
          <p className="font-heading text-5xl tracking-tight text-foreground sm:text-6xl">
            Personal Agents
          </p>
          <h1 className="mt-4 text-xl text-muted-foreground sm:text-2xl">
            One Cursor agent per person — private memory, encrypted logins, and
            skills in their own repo.
          </h1>
          <p className="mt-4 max-w-lg text-sm text-muted-foreground">
            Sign in with email, then chat with your agent in the app. No Slack
            account required.
          </p>
        </div>

        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background/80 p-6 shadow-sm backdrop-blur">
          <div className="flex gap-2 text-sm">
            <a
              href="/?mode=login"
              className={
                mode === "login"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Sign in
            </a>
            <span className="text-muted-foreground">·</span>
            <a
              href="/?mode=signup"
              className={
                mode === "signup"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Create account
            </a>
          </div>

          {error && (
            <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <form
            action={
              mode === "signup"
                ? "/api/auth/email/signup"
                : "/api/auth/email/login"
            }
            method="post"
            className="mt-5 space-y-3"
          >
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Name</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  placeholder="Ada"
                  autoComplete="name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                placeholder={mode === "signup" ? "At least 8 characters" : ""}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
              />
            </div>
            <Button type="submit" className="w-full">
              {mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
