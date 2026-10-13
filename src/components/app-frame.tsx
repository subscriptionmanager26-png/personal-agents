"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const TITLES: [string, string][] = [
  ["/app/clients", "Users"],
  ["/app/skills", "Skills"],
  ["/app/workspace", "Agent settings"],
  ["/app/developers", "Developers"],
  ["/app/connections", "Connections"],
  ["/app/settings", "Settings"],
  ["/app/admin", "Monitor"],
  ["/app", "Overview"],
];

/** Slim top bar for full-height pages (chat, console) and the default page frame. */
export function TopBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-backdrop-filter:bg-background/70">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
      <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
      {children}
    </header>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/app/chat") || pathname.startsWith("/app/console")) return <>{children}</>;
  const title = TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "";
  return (
    <>
      <TopBar title={title} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8">{children}</div>
    </>
  );
}
