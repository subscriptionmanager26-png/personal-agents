import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/lib/session";
import { listSkillCatalog } from "@/lib/skills";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) return null;
  const user = await getUser(session.id);
  const catalog = listSkillCatalog();
  const enabled = user?.enabledSkillIds ?? [];
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Skills</h1>
        <p className="mt-1 text-muted-foreground">
          Install catalog skills into your personal agent repo. More skills can
          be added to the catalog over time.
        </p>
        <p className="mt-2 break-all text-xs text-muted-foreground">
          Target repo:{" "}
          {user?.agentRepository ||
            "will be provisioned on first install / Slack task"}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4">
        {catalog.map((skill) => {
          const on = enabled.includes(skill.id);
          return (
            <Card key={skill.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {skill.name}
                    {on ? (
                      <Badge>installed</Badge>
                    ) : (
                      <Badge variant="outline">available</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {skill.description}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <form action="/app/skills/toggle" method="post">
                    <input type="hidden" name="skillId" value={skill.id} />
                    <input
                      type="hidden"
                      name="action"
                      value={on ? "uninstall" : "install"}
                    />
                    <Button
                      variant={on ? "outline" : "default"}
                      size="sm"
                      type="submit"
                    >
                      {on ? "Disable" : "Install"}
                    </Button>
                  </form>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Installs to <code>{skill.installPath}</code>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
