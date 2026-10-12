import Link from "next/link";

export type NavLink = { href: string; label: string };

export function AppNav({
  displayName,
  workspaceName,
  links,
  showSettings,
}: {
  displayName?: string;
  workspaceName?: string;
  links: NavLink[];
  showSettings: boolean;
}) {
  return (
    <header className="border-b border-border/80 bg-[color-mix(in_oklab,var(--background),var(--chart-2)_6%)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-6">
          <Link href="/app" className="font-heading text-lg tracking-tight">
            {workspaceName || "Personal Agents"}
          </Link>
          <nav className="flex flex-wrap gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{displayName || "Signed in"}</span>
          {showSettings && (
            <Link href="/app/settings" className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Settings
            </Link>
          )}
          <a
            href="/api/auth/logout"
            className="rounded-md border border-border bg-background px-2.5 py-1.5 hover:bg-muted"
          >
            Sign out
          </a>
        </div>
      </div>
    </header>
  );
}
