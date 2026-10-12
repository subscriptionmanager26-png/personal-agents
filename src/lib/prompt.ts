import { listEarlierConversationJobs } from "@/lib/jobs";
import { buildMemoryPack } from "@/lib/memory";
import { getSkillCatalogEntry } from "@/lib/skills";
import { scrub } from "@/lib/trace";
import { listVaultLabels } from "@/lib/vault";
import type { Job, PersonalUser } from "@/lib/types";

const RECALL_PROMPT_CHARS = 600;
const RECALL_REPLY_CHARS = 1500;
const RECALL_TOTAL_CHARS = 6000;

function clip(text: string, max: number) {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}… [truncated]` : t;
}

/** Recent turns of this conversation, oldest first, within a fixed character budget. */
export async function buildRecentConversation(job: Job) {
  const earlier = await listEarlierConversationJobs(job);
  const turns: string[] = [];
  let used = 0;
  for (const j of earlier) {
    const turn = `User: ${clip(j.prompt, RECALL_PROMPT_CHARS)}\nYou: ${clip(j.reply!.message, RECALL_REPLY_CHARS)}`;
    const safe = String(scrub(turn));
    if (used + safe.length > RECALL_TOTAL_CHARS) break;
    turns.unshift(safe);
    used += safe.length;
  }
  return turns.length ? turns.join("\n\n") : "";
}

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
  const recent = await buildRecentConversation(job);

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

## Recent conversation
${recent ? `Earlier messages in this chat, oldest first (context only; the user's new question is at the end):\n${recent}` : "(this is the first message in this chat)"}

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

## Suggesting memories
If you learned something durable about the user that would help in future chats (a preference, a standing fact about them, a conclusion they want kept), propose it by ending your final message with one fenced block:

\`\`\`memory
[{"kind": "preference", "title": "Short title", "content": "One or two sentences."}]
\`\`\`

kind is one of preference, fact, note, research_summary. At most 3 entries; skip the block when there is nothing new or it is already in Memory above. The user reviews each suggestion before it is used. Never include passwords, codes, account numbers, tokens or anything from the vault.

---
User question:
${question}`;
}
