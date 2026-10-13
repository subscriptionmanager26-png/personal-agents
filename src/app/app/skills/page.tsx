import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listSkillTemplates } from "@/lib/skills";
import type { WorkspaceSkill } from "@/lib/types";
import { requireAgentUser } from "@/lib/viewer";

export const dynamic = "force-dynamic";

function SkillEditor({ skill }: { skill?: WorkspaceSkill }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{skill ? `Edit ${skill.name}` : "New skill"}</CardTitle>
        <CardDescription>
          Write it like instructions to a smart new analyst: when to use it, the steps, what a
          good answer looks like. Markdown works.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action="/app/skills/save" method="post" className="space-y-3">
          {skill && <input type="hidden" name="id" value={skill.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required defaultValue={skill?.name} placeholder="Portfolio review" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">When should the agent use it?</Label>
              <Input
                id="description"
                name="description"
                defaultValue={skill?.description}
                placeholder="When the client asks how their portfolio is doing"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content">Instructions</Label>
            <Textarea
              id="content"
              name="content"
              required
              rows={18}
              defaultValue={skill?.content}
              className="font-mono text-xs"
              placeholder={"# Portfolio review\n\n1. Pull current holdings from the client's connected broker.\n2. ..."}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit">Save skill</Button>
            <Link href="/app/skills" className="inline-flex items-center px-3 text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, isOwner } = await requireAgentUser();
  const skills = workspace?.skills ?? [];
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const editId = typeof params.edit === "string" ? params.edit : "";
  const editing = isOwner ? skills.find((s) => s.id === editId) : undefined;
  const creating = isOwner && params.new === "1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
        <p className="mt-1 text-muted-foreground">
          {isOwner
            ? "Your playbooks. Every client's agent gets all of these. Edits reach each agent on its next message."
            : `What your agent knows how to do, from ${workspace?.name}.`}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {(editing || creating) && <SkillEditor skill={editing} />}

      {isOwner && !editing && !creating && (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/app/skills?new=1"
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
          >
            New skill
          </Link>
          {listSkillTemplates().map((t) => (
            <form key={t.id} action="/app/skills/save" method="post">
              <input type="hidden" name="template" value={t.id} />
              <Button variant="outline" size="sm" type="submit" title={t.description}>
                Start from “{t.name}”
              </Button>
            </form>
          ))}
        </div>
      )}

      {!skills.length ? (
        <p className="text-sm text-muted-foreground">
          {isOwner ? "No skills yet." : "No skills have been added yet."}
        </p>
      ) : (
        <div className="grid gap-3">
          {skills.map((skill) => (
            <Card key={skill.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle>{skill.name}</CardTitle>
                  {skill.description && <CardDescription className="mt-1">{skill.description}</CardDescription>}
                </div>
                {isOwner && (
                  <div className="flex shrink-0 gap-1">
                    <Link
                      href={`/app/skills?edit=${skill.id}`}
                      className="inline-flex h-7 items-center rounded-md px-2.5 text-sm hover:bg-muted"
                    >
                      Edit
                    </Link>
                    <form action="/app/skills/delete" method="post">
                      <input type="hidden" name="id" value={skill.id} />
                      <Button variant="ghost" size="sm" type="submit">
                        Delete
                      </Button>
                    </form>
                  </div>
                )}
              </CardHeader>
              {isOwner && (
                <CardContent className="text-xs text-muted-foreground">
                  {skill.content.length.toLocaleString()} characters · updated{" "}
                  {new Date(skill.updatedAt).toLocaleDateString()}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
