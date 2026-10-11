import crypto from "node:crypto";

import { getConfig } from "@/lib/config";
import { readSkillFiles } from "@/lib/skills";
import { appendAudit, updateUser } from "@/lib/users";
import type { PersonalUser } from "@/lib/types";

const API = "https://api.github.com";

function authHeaders() {
  const { githubToken } = getConfig();
  if (!githubToken) throw new Error("GITHUB_TOKEN is not configured");
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "personal-agents-control-plane",
  };
}

export function isGithubConfigured() {
  return Boolean(getConfig().githubToken);
}

/** Org login from env, or the authenticated GitHub user when GITHUB_ORG is unset. */
async function resolveGithubOwner() {
  const { githubOrg } = getConfig();
  if (githubOrg) return { owner: githubOrg, isOrg: true as const };
  const user = await gh<{ login?: string }>("/user");
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
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: T | unknown }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
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

/** Push vault MCP + environment files into an existing personal repo. */
export async function syncVaultRuntimeFiles(repoUrl: string) {
  if (!isGithubConfigured()) return;
  const { owner, repo } = parseRepo(repoUrl);
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const root = path.join(process.cwd(), "agent-template");
  const files = [
    "tools/vault-mcp/server.mjs",
    ".cursor/environment.json",
    ".cursor/skills/security/vault-proxy/SKILL.md",
    "AGENTS.md",
  ];
  for (const rel of files) {
    const content = await fs.readFile(path.join(root, rel), "utf8");
    await putFile(owner, repo, rel, content, `Sync vault runtime: ${rel}`);
  }
}

/** Ensure the user has a personal agent repository. Uses template when set. */
export async function ensurePersonalRepo(user: PersonalUser): Promise<PersonalUser> {
  if (user.agentRepository) {
    try {
      await syncVaultRuntimeFiles(user.agentRepository);
    } catch {
      // best-effort; agent may still work without latest vault MCP
    }
    return user;
  }
  if (!isGithubConfigured()) {
    const updated = await updateUser(user.id, {
      provisionError:
        "GitHub not configured. Set GITHUB_TOKEN (optional GITHUB_ORG, AGENT_TEMPLATE_REPO).",
    });
    return updated ?? user;
  }

  let ownerInfo;
  try {
    ownerInfo = await resolveGithubOwner();
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
      ownerInfo.isOrg ? `/orgs/${ownerInfo.owner}/repos` : "/user/repos",
      { method: "POST", body: JSON.stringify(payload) },
    );

    // Org missing / no access → fall back to the token's user account.
    if (!created.ok && ownerInfo.isOrg) {
      created = await gh<{ html_url?: string; full_name?: string }>(
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
    await seedTemplateFiles(createdUrl);
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
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string,
) {
  const existing = await gh<{ sha?: string }>(
    `/repos/${owner}/${repo}/contents/${filePath}`,
  );
  const sha =
    existing.ok && existing.body && typeof existing.body === "object"
      ? (existing.body as { sha?: string }).sha
      : undefined;
  return gh(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
    }),
  });
}

async function seedTemplateFiles(repoUrl: string) {
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
        await putFile(owner, repo, rel, content, `Seed ${rel}`);
      }
    }
  }
  await walk(root);
}

export async function installSkillToUserRepo(
  user: PersonalUser,
  skillId: string,
) {
  let current = user;
  if (!isGithubConfigured()) {
    // Local/dev: enable in control plane without writing to GitHub
    const enabled = Array.from(
      new Set([...(current.enabledSkillIds || []), skillId]),
    );
    const updated = await updateUser(current.id, {
      enabledSkillIds: enabled,
      provisionError: undefined,
    });
    await appendAudit({
      ownerUserId: current.id,
      type: "skill.install",
      detail: `Enabled ${skillId} locally (GitHub not configured)`,
    });
    return updated ?? current;
  }

  if (!current.agentRepository) {
    current = await ensurePersonalRepo(current);
  }
  if (!current.agentRepository) {
    throw new Error(current.provisionError || "No agent repository");
  }

  const { entry, files } = await readSkillFiles(skillId);
  const { owner, repo } = parseRepo(current.agentRepository);
  for (const file of files) {
    const dest = `${entry.installPath}/${file.relativePath}`;
    const result = await putFile(
      owner,
      repo,
      dest,
      file.content,
      `Install skill ${entry.id}: ${file.relativePath}`,
    );
    if (!result.ok) {
      throw new Error(
        `Failed to write ${dest}: ${JSON.stringify(result.body).slice(0, 200)}`,
      );
    }
  }
  const enabled = Array.from(
    new Set([...(current.enabledSkillIds || []), skillId]),
  );
  const updated = await updateUser(current.id, { enabledSkillIds: enabled });
  await appendAudit({
    ownerUserId: current.id,
    type: "skill.install",
    detail: `Installed ${skillId} into ${current.agentRepository}`,
  });
  return updated ?? current;
}

export async function uninstallSkillFlag(user: PersonalUser, skillId: string) {
  const enabled = (user.enabledSkillIds || []).filter((id) => id !== skillId);
  const updated = await updateUser(user.id, { enabledSkillIds: enabled });
  await appendAudit({
    ownerUserId: user.id,
    type: "skill.uninstall",
    detail: `Disabled skill ${skillId}`,
  });
  return updated ?? user;
}
