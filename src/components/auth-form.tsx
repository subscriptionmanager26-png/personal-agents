import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  mode,
  error,
  basePath,
  workspaceSlug,
  signupLabel = "Create account",
}: {
  mode: "login" | "signup";
  error?: string;
  /** Page the mode links point at, e.g. "/" or "/join/acme". */
  basePath: string;
  workspaceSlug?: string;
  signupLabel?: string;
}) {
  const tab = (active: boolean) =>
    active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground";
  return (
    <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background/80 p-6 shadow-sm backdrop-blur">
      <div className="flex gap-2 text-sm">
        <Link href={`${basePath}?mode=login`} className={tab(mode === "login")}>
          Sign in
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`${basePath}?mode=signup`} className={tab(mode === "signup")}>
          {signupLabel}
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <form
        action={mode === "signup" ? "/api/auth/email/signup" : "/api/auth/email/login"}
        method="post"
        className="mt-5 space-y-3"
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
        <Button type="submit" className="w-full">
          {mode === "signup" ? signupLabel : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
