import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  const user = await getUser(session.id);
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background),var(--chart-2)_5%),var(--background)_240px)]">
      <AppNav displayName={user?.displayName || session.displayName} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</div>
    </div>
  );
}
