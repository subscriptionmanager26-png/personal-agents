"use client";

import {
  Activity,
  BookOpen,
  ChevronsUpDown,
  Code2,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Plug,
  Settings,
  SlidersHorizontal,
  SquarePen,
  Sun,
  TerminalSquare,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import type { ChatThread } from "@/lib/threads";

const ICONS = {
  overview: LayoutGrid,
  console: TerminalSquare,
  users: Users,
  skills: BookOpen,
  settings: SlidersHorizontal,
  developers: Code2,
  connections: Plug,
  monitor: Activity,
} as const;

export type SidebarLink = { href: string; label: string; icon: keyof typeof ICONS };

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function groupThreads(threads: ChatThread[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const groups: { label: string; items: ChatThread[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const t of threads) {
    const at = Date.parse(t.updatedAt);
    const index = at >= startOfToday.getTime() ? 0 : at >= startOfToday.getTime() - day ? 1 : at >= startOfToday.getTime() - 7 * day ? 2 : 3;
    groups[index].items.push(t);
  }
  return groups.filter((g) => g.items.length);
}

function Threads({ threads }: { threads: ChatThread[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { setOpenMobile } = useSidebar();
  const onChat = pathname === "/app/chat";
  const current = params.get("t") ?? (params.get("new") ? undefined : threads[0]?.id);

  if (!threads.length) {
    return (
      <p className="px-4 py-2 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
        Your conversations will appear here.
      </p>
    );
  }
  return groupThreads(threads).map((group) => (
    <SidebarGroup key={group.label} className="py-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((t) => (
            <SidebarMenuItem key={t.id}>
              <SidebarMenuButton
                isActive={onChat && current === t.id}
                render={<Link href={`/app/chat?t=${encodeURIComponent(t.id)}`} onClick={() => setOpenMobile(false)} />}
                className="h-8"
              >
                <span className="truncate">{t.title}</span>
                {t.working && <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-info" />}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}

function NavUser({ name, email, showSettings }: { name: string; email?: string; showSettings: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />
            }
          >
            <Avatar className="size-7 rounded-md">
              <AvatarFallback className="rounded-md bg-sidebar-accent text-[11px] font-medium">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium text-sidebar-accent-foreground">{name}</span>
              {email && <span className="truncate text-xs text-sidebar-foreground/60">{email}</span>}
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--anchor-width) min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{email || name}</DropdownMenuLabel>
            </DropdownMenuGroup>
            {showSettings && (
              <DropdownMenuItem render={<Link href="/app/settings" />}>
                <Settings />
                Settings
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme ?? "dark"} onValueChange={(v) => setTheme(String(v))}>
                <DropdownMenuRadioItem value="dark">
                  <Moon />
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  <Sun />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <Monitor />
                  System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href="/api/auth/logout" />}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({
  workspaceName,
  roleLabel,
  links,
  footerLinks = [],
  threads,
  user,
  showSettings,
}: {
  workspaceName: string;
  roleLabel: string;
  links: SidebarLink[];
  footerLinks?: SidebarLink[];
  /** Present when the viewer chats with their own agent. */
  threads?: ChatThread[];
  user: { name: string; email?: string };
  showSettings: boolean;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  const navItem = (link: SidebarLink) => {
    const Icon = ICONS[link.icon];
    return (
      <SidebarMenuItem key={link.href}>
        <SidebarMenuButton
          isActive={isActive(link.href)}
          tooltip={link.label}
          render={<Link href={link.href} onClick={() => setOpenMobile(false)} />}
        >
          <Icon />
          <span>{link.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/app" />} className="hover:bg-transparent active:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                {initials(workspaceName).slice(0, 1)}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">{workspaceName}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">{roleLabel}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {threads && (
            <SidebarMenuItem className="mt-1">
              <SidebarMenuButton
                tooltip="New chat"
                render={<Link href="/app/chat?new=1" onClick={() => setOpenMobile(false)} />}
                className="border border-sidebar-border bg-sidebar-accent/40 font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent"
              >
                <SquarePen />
                <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin">
        {links.length > 0 && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>{links.map(navItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {threads && (
          <Suspense>
            <Threads threads={threads} />
          </Suspense>
        )}
      </SidebarContent>

      <SidebarFooter>
        {footerLinks.length > 0 && <SidebarMenu>{footerLinks.map(navItem)}</SidebarMenu>}
        <NavUser name={user.name} email={user.email} showSettings={showSettings} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
