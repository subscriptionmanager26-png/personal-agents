import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listMemories } from "@/lib/memory";
import { requireAgentUser } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, workspace, isOwner } = await requireAgentUser();
  const memoryCount = (await listMemories(user.id)).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>{user.displayName || "—"}</p>
          <p className="text-muted-foreground">{user.email}</p>
          <p className="text-muted-foreground">
            {isOwner ? `Owner of ${workspace?.name}` : `Client of ${workspace?.name}`}
          </p>
        </CardContent>
      </Card>

      <Link href="/app/settings/memory" className="block">
        <Card className="transition hover:border-foreground/30">
          <CardHeader>
            <CardTitle>Agent memory</CardTitle>
            <CardDescription>
              {memoryCount
                ? `Your agent remembers ${memoryCount} thing${memoryCount === 1 ? "" : "s"} about you. Review or delete them.`
                : "Your agent hasn't saved anything yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}
