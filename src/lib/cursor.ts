import { AGENT_MCP_NAME } from "@/lib/agent-mcp";
import { companyServersForUser } from "@/lib/company";
import { getConfig, isMockCursor } from "@/lib/config";
import { mcpServersForUser } from "@/lib/connections";
import {
  createRun,
  cursorPost,
  extractAgentId,
  extractRunId,
  getAgent,
  getAgentConversation,
  getRun,
  type McpServerDef,
} from "@/lib/cursor-api";
import { ensurePersonalRepo, syncWorkspaceSkills } from "@/lib/github";
import { patchJob } from "@/lib/jobs";
import { mockRunId } from "@/lib/mock-trace";
import { buildPersonalAgentPrompt } from "@/lib/prompt";
import { createMemoryToken } from "@/lib/run-token";
import { createVaultJobToken, listVaultLabels } from "@/lib/vault";
import { getUser, updateUser } from "@/lib/users";
import { canUseAgent, getWorkspace, skillsHash } from "@/lib/workspaces";
import type { Job, PersonalUser, Workspace } from "@/lib/types";

/** Cursor's backend must be able to reach our memory MCP endpoint. */
function publicBaseUrl() {
  const url = getConfig().publicUrl.replace(/\/$/, "");
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "0.0.0.0" || host.startsWith("127.")) return undefined;
  } catch {
    return undefined;
  }
  return url;
}

async function failJob(job: Job, userId: string, detail: string) {
  await patchJob(job.id, userId, { status: "error", error: detail, event: { type: "error", detail } });
}

async function buildMcpServers(user: PersonalUser, job: Job, workspace: Workspace | undefined) {
  const servers: McpServerDef[] = [];
  const base = publicBaseUrl();
  if (base) {
    servers.push({
      name: AGENT_MCP_NAME,
      type: "http",
      url: `${base}/api/mcp/agent`,
      headers: { Authorization: `Bearer ${await createMemoryToken({ ownerUserId: user.id, jobId: job.id })}` },
    });
  }
  const company = await companyServersForUser(workspace, user);
  servers.push(...company);
  if (base && (await listVaultLabels(user.id)).length) {
    // vault_fill must type into the VM's browser, so this one runs inside the VM.
    servers.push({
      name: "personal-vault",
      type: "stdio",
      command: "node",
      args: ["tools/vault-mcp/server.mjs"],
      env: {
        PA_VAULT_JOB_TOKEN: await createVaultJobToken({ ownerUserId: user.id, jobId: job.id }),
        PA_PUBLIC_URL: base,
        PA_JOB_ID: job.id,
      },
    });
  }
  const connections = await mcpServersForUser(user.id);
  servers.push(...connections);
  return {
    servers,
    agentTools: Boolean(base),
    companyServers: company.map((c) => c.name),
    connections: connections.map((c) => c.name),
  };
}

export async function dispatchJob(user: PersonalUser, job: Job) {
  const latest = (await getUser(user.id)) ?? user;
  if (!canUseAgent(latest)) {
    await failJob(
      job,
      latest.id,
      latest.role === "client" && latest.membershipStatus === "pending"
        ? "Your account is waiting for approval."
        : "Your agent is not available. Contact the workspace owner.",
    );
    return { user: latest, agentId: undefined, mock: false };
  }
  const workspace = await getWorkspace(latest.workspaceId);

  if (isMockCursor()) {
    const mockId = latest.cursorAgentId || `mock-${latest.id}`;
    const current = latest.cursorAgentId
      ? latest
      : ((await updateUser(latest.id, { cursorAgentId: mockId })) ?? latest);
    await patchJob(job.id, current.id, {
      status: "dispatched",
      cursorAgentId: mockId,
      cursorRunId: mockRunId(job.id),
      cursorHttpStatus: 200,
      cursorBody: { mock: true, id: mockId },
      event: { type: "dispatch", detail: "Mock Cursor dispatch (CURSOR_API_KEY unset)" },
    });
    const { runMockAgent } = await import("@/lib/mock-agent");
    const message = await runMockAgent(current, job, workspace);
    const { settleJob } = await import("@/lib/settle");
    await settleJob(job.id, current.id, { message });
    return { user: current, agentId: mockId, mock: true };
  }

  let current = await ensurePersonalRepo(latest);
  if (!current.agentRepository) {
    await failJob(job, current.id, current.provisionError || "Personal repo missing");
    throw new Error(current.provisionError || "Personal repo missing");
  }

  let skillsInRepo = false;
  try {
    skillsInRepo = Boolean(await syncWorkspaceSkills(current, workspace));
    current = (await getUser(current.id)) ?? current;
  } catch {
    // fall back to inlining the skills in the prompt
  }
  const hash = skillsHash(workspace);
  const mcp = await buildMcpServers(current, job, workspace);
  const promptText = await buildPersonalAgentPrompt(current, job, {
    agentTools: mcp.agentTools,
    skillsInRepo,
    companyServers: mcp.companyServers,
    connections: mcp.connections,
  });

  // One standing agent per client; replace it only when the owner's skills changed,
  // because a running agent keeps the repo checkout it started with.
  if (current.cursorAgentId && current.cursorAgentSkillsHash === hash) {
    const run = await createRun(current.cursorAgentId, promptText, mcp.servers);
    const runId = run.ok ? extractRunId(run.body) : undefined;
    if (runId) {
      await patchJob(job.id, current.id, {
        status: "dispatched",
        cursorAgentId: current.cursorAgentId,
        cursorRunId: runId,
        cursorHttpStatus: run.status,
        cursorBody: run.body,
        event: { type: "dispatch", detail: `New run on agent ${current.cursorAgentId}` },
      });
      return { user: current, agentId: current.cursorAgentId, mock: false };
    }
    if (run.status === 409) {
      await failJob(job, current.id, "Your agent is still working on the previous message. Try again when it replies.");
      return { user: current, agentId: current.cursorAgentId, mock: false };
    }
    // Agent expired or was removed: start a fresh one below. Memory and recent chat carry over.
  }

  const created = await createAgent(current, promptText, mcp.servers);
  current =
    (await updateUser(current.id, { cursorAgentId: created.agentId, cursorAgentSkillsHash: hash })) ?? current;
  await patchJob(job.id, current.id, {
    status: "dispatched",
    cursorAgentId: created.agentId,
    cursorRunId: created.runId,
    cursorHttpStatus: created.status,
    cursorBody: created.body,
    event: { type: "dispatch", detail: `Created agent ${created.agentId}` },
  });
  return { user: current, agentId: created.agentId, mock: false };
}

async function createAgent(user: PersonalUser, promptText: string, mcpServers: McpServerDef[]) {
  const cfg = getConfig();
  const repository = user.agentRepository!;

  const v1 = await cursorPost("/v1/agents", {
    prompt: { text: promptText },
    repos: [{ url: repository, startingRef: user.agentRef || "main" }],
    autoCreatePR: false,
    skipReviewerRequest: true,
    mcpServers,
  });
  const v1Id = extractAgentId((v1.body as { agent?: unknown })?.agent) || extractAgentId(v1.body);
  if (v1.ok && v1Id) {
    return { agentId: v1Id, runId: extractRunId(v1.body), status: v1.status, body: v1.body };
  }

  const v0Body: Record<string, unknown> = {
    prompt: { text: promptText },
    source: { repository, ref: user.agentRef || "main" },
    target: { autoCreatePr: false },
  };
  if (cfg.cursorStatusWebhookUrl && cfg.cursorStatusWebhookSecret) {
    v0Body.webhook = { url: cfg.cursorStatusWebhookUrl, secret: cfg.cursorStatusWebhookSecret };
  }
  const result = await cursorPost("/v0/agents", v0Body);
  const agentId = extractAgentId(result.body);
  if (!result.ok || !agentId) {
    throw new Error(`Cursor create failed: ${JSON.stringify(v1.body || result.body).slice(0, 400)}`);
  }
  return { agentId, runId: undefined as string | undefined, status: result.status, body: result.body };
}

export async function fetchFinalAssistantMessage(agentId: string, runId?: string) {
  if (agentId.startsWith("mock-")) {
    return "Mock agent completed.";
  }
  if (runId) {
    try {
      const run = await getRun(agentId, runId);
      if (run.result?.trim()) return run.result.trim();
    } catch {
      // fall back to the v0 conversation below
    }
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
