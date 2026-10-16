import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  mode,
  error,
  basePath,
  workspaceSlug,
  signupLabel = "Create account",
  hideSignup = false,
}: {
  mode: "login" | "signup";
  error?: string;
  /** Page the mode links point at, e.g. "/" or "/join/acme". */
  basePath: string;
  workspaceSlug?: string;
  signupLabel?: string;
  hideSignup?: boolean;
}) {
  const tab = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-center text-sm transition-colors ${
      active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
      {!hideSignup && (
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <Link href={`${basePath}?mode=login`} className={tab(mode === "login")}>
            Sign in
          </Link>
          <Link href={`${basePath}?mode=signup`} className={tab(mode === "signup")}>
            {signupLabel}
          </Link>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form
        action={mode === "signup" ? "/api/auth/email/signup" : "/api/auth/email/login"}
        method="post"
        className="mt-5 space-y-4"
      >
        {workspaceSlug && <input type="hidden" name="workspace" value={workspaceSlug} />}
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Name</Label>
            <Input id="displayName" name="displayName" placeholder="Ada" autoComplete="name" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="you@company.com" autoComplete="email" />
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
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </div>
        <Button type="submit" className="h-9 w-full">
          {mode === "signup" ? signupLabel : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

/** Centered sign-in layout shared by the home and join pages. */
export function AuthPage({
  brand,
  title,
  description,
  footnote,
  children,
}: {
  brand: string;
  title: string;
  description: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex items-center gap-2 text-sm font-medium">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
              {brand.slice(0, 1).toUpperCase()}
            </span>
            {brand}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-balance text-muted-foreground">{description}</p>
        </div>
        {children}
        {footnote && <p className="px-2 text-center text-xs leading-relaxed text-balance text-muted-foreground">{footnote}</p>}
      </div>
    </main>
  );
}
