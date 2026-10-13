import crypto from "node:crypto";

import { getConfig } from "@/lib/config";
import { runtimeForUser } from "@/lib/runtime";
import { renderSkillFile, skillInstallDir } from "@/lib/skills";
import { appendAudit, updateUser } from "@/lib/users";
import { skillsHash } from "@/lib/workspaces";
import type { PersonalUser, Workspace } from "@/lib/types";

const API = "https://api.github.com";

type GithubCreds = { token: string; org: string };

/** The client's workspace token (or the GITHUB_TOKEN fallback); never another workspace's. */
async function credsFor(user: PersonalUser): Promise<GithubCreds> {
  const rt = await runtimeForUser(user);
  return { token: rt.githubToken, org: rt.githubOrg };
}

function authHeaders(token: string) {
  if (!token) throw new Error("GitHub is not configured");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "personal-agents-control-plane",
  };
}

/** The configured org, or the token's own GitHub account. */
async function resolveGithubOwner(creds: GithubCreds) {
  if (creds.org) return { owner: creds.org, isOrg: true as const };
  const user = await gh<{ login?: string }>(creds, "/user");
  const login =
    user.ok && user.body && typeof user.body === "object"
      ? (user.body as { login?: string }).login
      : undefined;
  if (!login) throw new Error("Could not resolve GitHub user from token");
  return { owner: login, isOrg: false as const };
}

function repoNameForUser(user: PersonalUser) {
  const suffix = crypto
    .createHash("sha256")
    .update(user.id)
    .digest("hex")
    .slice(0, 6);
  if (user.email) {
    const local = user.email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    return `agent-${local || "user"}-${suffix}`.slice(0, 100);
  }
  const team = (user.slackTeamId || "team")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  const uid = (user.slackUserId || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return `agent-${team}-${uid}-${suffix}`.slice(0, 100);
}

async function gh<T>(
  creds: GithubCreds,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: T | unknown }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(creds.token),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { ok: response.ok, status: response.status, body };
}

const RUNTIME_FILES = [
  "tools/vault-mcp/server.mjs",
  ".cursor/environment.json",
  ".cursor/skills/security/vault-proxy/SKILL.md",
  "AGENTS.md",
];

/** Push vault MCP + environment files into an existing personal repo when they changed. */
export async function syncVaultRuntimeFiles(user: PersonalUser): Promise<PersonalUser> {
  const creds = await credsFor(user);
  if (!creds.token || !user.agentRepository) return user;
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const root = path.join(process.cwd(), "agent-template");
  const files = await Promise.all(
    RUNTIME_FILES.map(async (rel) => ({ rel, content: await fs.readFile(path.join(root, rel), "utf8") })),
  );
  const hash = crypto
    .createHash("sha256")
    .update(files.map((f) => `${f.rel}\n${f.content}`).join("\n\u0000\n"))
    .digest("hex")
    .slice(0, 16);
  if (user.runtimeSyncedHash === hash) return user;

  const { owner, repo } = parseRepo(user.agentRepository);
  for (const file of files) {
    await putFile(creds, owner, repo, file.rel, file.content, `Sync agent runtime: ${file.rel}`);
  }
  return (await updateUser(user.id, { runtimeSyncedHash: hash })) ?? user;
}

/** Ensure the user has a personal agent repository. Uses template when set. */
export async function ensurePersonalRepo(user: PersonalUser): Promise<PersonalUser> {
  if (user.agentRepository) {
    try {
      return await syncVaultRuntimeFiles(user);
    } catch {
      // best-effort; agent may still work without latest vault MCP
      return user;
    }
  }
  const creds = await credsFor(user);
  if (!creds.token) {
    const updated = await updateUser(user.id, {
      provisionError:
        "GitHub is not configured. The workspace owner can add a GitHub token under Developers → Agent runtime.",
    });
    return updated ?? user;
  }

  let ownerInfo;
  try {
    ownerInfo = await resolveGithubOwner(creds);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const updated = await updateUser(user.id, { provisionError: detail });
    return updated ?? user;
  }

  const { agentTemplateRepo } = getConfig();
  const name = repoNameForUser(user);
  const fullName = `${ownerInfo.owner}/${name}`;

  // Already exists?
  const existing = await gh<{ html_url?: string; clone_url?: string }>(
    creds,
    `/repos/${fullName}`,
  );
  if (existing.ok) {
    const url =
      (existing.body as { html_url?: string }).html_url ||
      `https://github.com/${fullName}`;
    const updated = await updateUser(user.id, {
      agentRepository: url,
      provisionError: undefined,
    });
    return updated ?? user;
  }

  let createdUrl = "";
  if (agentTemplateRepo) {
    const [templateOwner, templateRepo] = agentTemplateRepo
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "")
      .split("/");
    const created = await gh<{ html_url?: string }>(
      creds,
      `/repos/${templateOwner}/${templateRepo}/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          owner: ownerInfo.owner,
          name,
          private: true,
          include_all_branches: false,
        }),
      },
    );
    if (!created.ok) {
      const detail = JSON.stringify(created.body).slice(0, 300);
      const updated = await updateUser(user.id, {
        provisionError: `Template generate failed: ${detail}`,
      });
      return updated ?? user;
    }
    createdUrl =
      (created.body as { html_url?: string }).html_url ||
      `https://github.com/${fullName}`;
  } else {
    const payload = {
      name,
      private: true,
      auto_init: true,
      description: `Personal Cursor agent workspace for ${user.id}`,
    };
    let created = await gh<{ html_url?: string; full_name?: string }>(
      creds,
      ownerInfo.isOrg ? `/orgs/${ownerInfo.owner}/repos` : "/user/repos",
      { method: "POST", body: JSON.stringify(payload) },
    );

    // Org missing / no access → fall back to the token's user account.
    if (!created.ok && ownerInfo.isOrg) {
      created = await gh<{ html_url?: string; full_name?: string }>(
        creds,
        "/user/repos",
        { method: "POST", body: JSON.stringify(payload) },
      );
    }

    if (!created.ok) {
      const detail = JSON.stringify(created.body).slice(0, 300);
      const updated = await updateUser(user.id, {
        provisionError: `Repo create failed: ${detail}`,
      });
      return updated ?? user;
    }
    createdUrl =
      (created.body as { html_url?: string }).html_url ||
      `https://github.com/${
        (created.body as { full_name?: string }).full_name || fullName
      }`;

    // Seed essential files from local agent-template
    await seedTemplateFiles(creds, createdUrl);
  }

  const updated = await updateUser(user.id, {
    agentRepository: createdUrl,
    provisionError: undefined,
  });
  await appendAudit({
    ownerUserId: user.id,
    type: "repo.provision",
    detail: `Provisioned ${createdUrl}`,
  });
  return updated ?? user;
}

function parseRepo(url: string) {
  const cleaned = url
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  const [owner, repo] = cleaned.split("/");
  return { owner, repo };
}

async function putFile(
  creds: GithubCreds,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string,
) {
  const existing = await gh<{ sha?: string }>(
    creds,
    `/repos/${owner}/${repo}/contents/${filePath}`,
  );
  const sha =
    existing.ok && existing.body && typeof existing.body === "object"
      ? (existing.body as { sha?: string }).sha
      : undefined;
  return gh(creds, `/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
    }),
  });
}

async function seedTemplateFiles(creds: GithubCreds, repoUrl: string) {
  const { owner, repo } = parseRepo(repoUrl);
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const root = path.join(process.cwd(), "agent-template");

  async function walk(dir: string, prefix = "") {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, rel);
      else if (ent.isFile()) {
        const content = await fs.readFile(full, "utf8");
        await putFile(creds, owner, repo, rel, content, `Seed ${rel}`);
      }
    }
  }
  await walk(root);
}

async function deleteFile(creds: GithubCreds, owner: string, repo: string, filePath: string, message: string) {
  const existing = await gh<{ sha?: string }>(creds, `/repos/${owner}/${repo}/contents/${filePath}`);
  const sha =
    existing.ok && existing.body && typeof existing.body === "object"
      ? (existing.body as { sha?: string }).sha
      : undefined;
  if (!sha) return;
  await gh(creds, `/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "DELETE",
    body: JSON.stringify({ message, sha }),
  });
}

const SKILL_MANIFEST = ".cursor/skills/workspace/manifest.json";

/**
 * Writes the workspace's skills into a client's repo and removes ones the owner deleted.
 * Returns the synced hash, or undefined when nothing was written.
 */
export async function syncWorkspaceSkills(user: PersonalUser, workspace: Workspace | undefined) {
  const hash = skillsHash(workspace);
  const creds = await credsFor(user);
  if (!creds.token || !user.agentRepository) return undefined;
  if (user.skillsSyncedHash === hash) return hash;

  const { owner, repo } = parseRepo(user.agentRepository);
  const skills = workspace?.skills ?? [];

  const manifest = await gh<{ content?: string }>(creds, `/repos/${owner}/${repo}/contents/${SKILL_MANIFEST}`);
  let previous: string[] = [];
  if (manifest.ok && manifest.body && typeof manifest.body === "object") {
    try {
      const raw = Buffer.from((manifest.body as { content?: string }).content || "", "base64").toString("utf8");
      previous = (JSON.parse(raw) as { slugs?: string[] }).slugs ?? [];
    } catch {
      previous = [];
    }
  }

  for (const skill of skills) {
    const dest = `${skillInstallDir(skill)}/SKILL.md`;
    const result = await putFile(creds, owner, repo, dest, renderSkillFile(skill), `Sync skill ${skill.slug}`);
    if (!result.ok) {
      throw new Error(`Failed to write ${dest}: ${JSON.stringify(result.body).slice(0, 200)}`);
    }
  }
  const current = new Set(skills.map((s) => s.slug));
  for (const slug of previous.filter((s) => !current.has(s))) {
    await deleteFile(creds, owner, repo, `${skillInstallDir({ slug })}/SKILL.md`, `Remove skill ${slug}`);
  }
  await putFile(
    creds,
    owner,
    repo,
    SKILL_MANIFEST,
    JSON.stringify({ slugs: [...current], hash }, null, 2),
    "Update skill manifest",
  );

  await updateUser(user.id, { skillsSyncedHash: hash });
  await appendAudit({
    ownerUserId: user.id,
    type: "skills.sync",
    detail: `Synced ${skills.length} workspace skills (${hash})`,
  });
  return hash;
}
