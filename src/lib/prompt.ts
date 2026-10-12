import { buildMemoryPack } from "@/lib/memory";
import { getSkillCatalogEntry } from "@/lib/skills";
import { listVaultLabels } from "@/lib/vault";
import type { Job, PersonalUser } from "@/lib/types";

/**
 * Model-facing prompt (Hermes / OpenInstinct style).
 * Never includes raw secrets or vault bearer tokens.
 */
export async function buildPersonalAgentPrompt(
  user: PersonalUser,
  job: Job,
) {
  const memory = await buildMemoryPack(user.id);
  const vaultLabels = await listVaultLabels(user.id);

  const skills = (user.enabledSkillIds || [])
    .map((id) => getSkillCatalogEntry(id))
    .filter(Boolean)
    .map(
      (s) =>
        `- ${s!.name} (${s!.id}): follow ${s!.installPath}/SKILL.md in this repo`,
    );

  const vaultList = vaultLabels.length
    ? vaultLabels
        .map((v) => {
          const origin = v.origin ? ` origin=${v.origin}` : "";
          const uname = v.username ? ` username=${v.username}` : "";
          return `- handle=${v.id} label="${v.label}"${uname}${origin}`;
        })
        .join("\n")
    : "(no saved credentials)";

  const question = job.threadContext
    ? `${job.prompt}\n\n---\nPrior thread context:\n${job.threadContext}`
    : job.prompt;

  return `You are a personal Cursor cloud agent for a single human. You must not disclose this user's data to anyone else.

Owner: ${user.displayName || user.email || user.slackUserId} (${user.id})
Personal repo: ${user.agentRepository || "(pending)"}
Job: ${job.id}

## Memory
${memory}

## Enabled skills
${skills.length ? skills.join("\n") : "(none enabled — answer helpfully anyway)"}

## Credential vault (model-blind — Hermes style)
Saved credential handles (metadata only — passwords never appear here):
${vaultList}

Use the MCP server **personal-vault** tools (do not invent curl auth):
- vault_list → refresh handles
- vault_fill({ handle, url, username_selector?, password_selector?, submit_selector? })
  Opens the page, checks origin binding, autofills username/password via Playwright.
  Tool result is only { filled_fields, origin, success } — never the password.
- vault_http({ handle, url, method, inject? })
  Authenticated HTTP via control-plane proxy; response scrubbed.

Never ask the user to paste passwords. Never print vault tokens or secrets.
If vault_fill fails with origin_mismatch, stop — do not try to bypass.

## Delivery
Write your answer in the final chat message. For long reports, also write to /opt/cursor/artifacts/ and artifacts/ in the workspace.

When you drive a browser or the desktop, the user cannot watch live. Save a screenshot after each meaningful step to artifacts/screens/NN-short-name.png (01-, 02-, …) and, when you can, a screen recording of the whole flow to artifacts/recording.mp4. Never capture a screen while a password or secret is visible.

---
User question:
${question}`;
}
