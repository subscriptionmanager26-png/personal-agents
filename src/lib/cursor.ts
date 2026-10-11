import { getConfig, isMockCursor } from "@/lib/config";
import {
  cursorPost,
  extractAgentId,
  getAgent,
  getAgentConversation,
} from "@/lib/cursor-api";
import { ensurePersonalRepo, syncVaultRuntimeFiles } from "@/lib/github";
import { patchJob } from "@/lib/jobs";
import { buildPersonalAgentPrompt } from "@/lib/prompt";
import { createVaultJobToken, listVaultLabels } from "@/lib/vault";
import { updateUser } from "@/lib/users";
import type { Job, PersonalUser } from "@/lib/types";

function repoUrlForCursor(url: string) {
  if (url.endsWith(".git")) return url;
  return url;
}

export async function dispatchJob(user: PersonalUser, job: Job) {
  let current = await ensurePersonalRepo(user);

  if (isMockCursor()) {
    const mockId = current.cursorAgentId || `mock-${current.id}`;
    if (!current.cursorAgentId) {
      current =
        (await updateUser(current.id, { cursorAgentId: mockId })) ?? current;
    }
    await patchJob(job.id, current.id, {
      status: "dispatched",
      cursorAgentId: mockId,
      cursorHttpStatus: 200,
      cursorBody: { mock: true, id: mockId },
      event: {
        type: "dispatch",
        detail: "Mock Cursor dispatch (CURSOR_API_KEY unset)",
      },
    });
    const { settleJob } = await import("@/lib/settle");
    await settleJob(job.id, current.id, {
      message: `Mock personal agent for ${current.displayName || current.email || current.id}.\n\nYou asked: ${job.prompt}\n\n(Configured skills: ${(current.enabledSkillIds || []).join(", ") || "none"}; repo: ${current.agentRepository || "not provisioned"})`,
    });
    return { user: current, agentId: mockId, mock: true };
  }

  if (!current.agentRepository) {
    await patchJob(job.id, current.id, {
      status: "error",
      error: current.provisionError || "Personal repo missing",
      event: {
        type: "error",
        detail: current.provisionError || "Personal repo missing",
      },
    });
    throw new Error(current.provisionError || "Personal repo missing");
  }

  if (current.agentRepository) {
    try {
      await syncVaultRuntimeFiles(current.agentRepository);
    } catch {
      // continue — create may still work if files already present
    }
  }

  const promptText = await buildPersonalAgentPrompt(current, job);
  const vaultItems = await listVaultLabels(current.id);
  const needsVaultSession = vaultItems.length > 0;

  // Vault MCP needs a fresh agent create so mcpServers.env can carry the job token.
  // Follow-ups cannot attach new MCP secrets.
  if (current.cursorAgentId && !needsVaultSession) {
    const follow = await cursorPost(
      `/v0/agents/${current.cursorAgentId}/followup`,
      { prompt: { text: promptText } },
    );
    if (follow.ok) {
      await patchJob(job.id, current.id, {
        status: "dispatched",
        cursorAgentId: current.cursorAgentId,
        cursorHttpStatus: follow.status,
        cursorBody: follow.body,
        event: {
          type: "dispatch",
          detail: `Followed up agent ${current.cursorAgentId}`,
        },
      });
      return { user: current, agentId: current.cursorAgentId, mock: false };
    }
  }

  const created = await createAgent(current, promptText, job);
  current =
    (await updateUser(current.id, { cursorAgentId: created.agentId })) ??
    current;
  await patchJob(job.id, current.id, {
    status: "dispatched",
    cursorAgentId: created.agentId,
    cursorHttpStatus: created.status,
    cursorBody: created.body,
    event: {
      type: "dispatch",
      detail: needsVaultSession
        ? `Created vault-MCP agent ${created.agentId}`
        : `Created agent ${created.agentId}`,
    },
  });
  return { user: current, agentId: created.agentId, mock: false };
}

async function createAgent(
  user: PersonalUser,
  promptText: string,
  job: Job,
) {
  const cfg = getConfig();
  const repository = repoUrlForCursor(user.agentRepository!);
  const vaultToken = await createVaultJobToken({
    ownerUserId: user.id,
    jobId: job.id,
  });
  const publicUrl = cfg.publicUrl;

  // Job token goes ONLY into the MCP server env — not agent shell envVars,
  // and never into the prompt (Hermes / OpenInstinct model-blind pattern).
  const v1Body: Record<string, unknown> = {
    prompt: { text: promptText },
    repos: [{ url: repository, startingRef: user.agentRef || "main" }],
    autoCreatePR: false,
    skipReviewerRequest: true,
    mcpServers: [
      {
        name: "personal-vault",
        type: "stdio",
        command: "node",
        args: ["tools/vault-mcp/server.mjs"],
        env: {
          PA_VAULT_JOB_TOKEN: vaultToken,
          PA_PUBLIC_URL: publicUrl,
          PA_JOB_ID: job.id,
        },
      },
    ],
  };

  const v1 = await cursorPost("/v1/agents", v1Body);
  const v1Id = extractAgentId(v1.body);
  if (v1.ok && v1Id) {
    return { agentId: v1Id, status: v1.status, body: v1.body };
  }

  const v0Body: Record<string, unknown> = {
    prompt: { text: promptText },
    source: { repository, ref: user.agentRef || "main" },
    target: { autoCreatePr: false },
  };
  if (cfg.cursorStatusWebhookUrl && cfg.cursorStatusWebhookSecret) {
    v0Body.webhook = {
      url: cfg.cursorStatusWebhookUrl,
      secret: cfg.cursorStatusWebhookSecret,
    };
  }
  const result = await cursorPost("/v0/agents", v0Body);
  const agentId = extractAgentId(result.body);
  if (!result.ok || !agentId) {
    throw new Error(
      `Cursor create failed: ${JSON.stringify(v1.body || result.body).slice(0, 400)}`,
    );
  }
  return { agentId, status: result.status, body: result.body };
}

export async function fetchFinalAssistantMessage(agentId: string) {
  if (agentId.startsWith("mock-")) {
    return "Mock agent completed.";
  }
  const conversation = await getAgentConversation(agentId);
  const messages = conversation.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const role = (m.type || m.role || "").toLowerCase();
    if (role.includes("assistant") || role === "ai_message") {
      if (m.text?.trim()) return m.text.trim();
    }
  }
  const agent = await getAgent(agentId);
  return `Agent status: ${agent.status || "unknown"}`;
}
