import { AGENT_MCP_NAME } from "@/lib/agent-mcp";
import { companyServersForUser } from "@/lib/company";
import { getConfig } from "@/lib/config";
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
import { getKiteConnection, KITE_MCP_NAME } from "@/lib/kite";
import { mockRunId } from "@/lib/mock-trace";
import { buildPersonalAgentPrompt } from "@/lib/prompt";
import { createMemoryToken } from "@/lib/run-token";
import { runtimeFor, runtimeForUserId, type AgentRuntime } from "@/lib/runtime";
import { createVaultJobToken, listVaultLabels } from "@/lib/vault";
import { agentBindingForJob, mockAgentIdForJob, saveAgentBindingForJob } from "@/lib/thread-agents";
import { getUser } from "@/lib/users";
import { canUseAgent, getWorkspace, skillsHash } from "@/lib/workspaces";
import type { Job, PersonalUser, Workspace } from "@/lib/types";

/** Local dev servers (the mock broker and backtester) are only reachable through the public URL. */
function reachableServerUrl(url: string, base: string | undefined) {
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === "localhost" || parsed.hostname.startsWith("127.");
    return local && base ? `${base}${parsed.pathname}${parsed.search}` : url;
  } catch {
    return url;
  }
}

async function failJob(job: Job, userId: string, detail: string) {
  await patchJob(job.id, userId, { status: "error", error: detail, event: { type: "error", detail } });
}

async function buildMcpServers(
  user: PersonalUser,
  job: Job,
  workspace: Workspace | undefined,
  rt: AgentRuntime,
  withRepo: boolean,
) {
  const servers: McpServerDef[] = [];
  // Cursor's backend must be able to reach our agent MCP endpoint.
  const base = rt.agentPublicUrl || undefined;
  if (base) {
    servers.push({
      name: AGENT_MCP_NAME,
      type: "http",
      url: `${base}/api/mcp/agent`,
      headers: { Authorization: `Bearer ${await createMemoryToken({ ownerUserId: user.id, jobId: job.id })}` },
    });
  }
  const company = (await companyServersForUser(workspace, user)).map((s) =>
    s.type === "stdio" ? s : { ...s, url: reachableServerUrl(s.url, base) },
  );
  servers.push(...company);
  // vault_fill must type into the VM's browser, so it runs inside the VM from the repo's copy.
  const vaultTools = Boolean(withRepo && base);
  if (withRepo && base && (await listVaultLabels(user.id)).length) {
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
  // The client's Kite session stays with us; the agent reaches Zerodha only through our read-only proxy.
  const zerodha = Boolean(base && (await getKiteConnection(user.id)));
  if (zerodha) {
    servers.push({
      name: KITE_MCP_NAME,
      type: "http",
      url: `${base}/api/mcp/zerodha`,
      headers: { Authorization: `Bearer ${await createMemoryToken({ ownerUserId: user.id, jobId: job.id })}` },
    });
  }
  return {
    servers,
    agentTools: Boolean(base),
    vaultTools,
    zerodha,
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
  const rt = runtimeFor(workspace);

  if (!rt.cursorApiKey) {
    const binding = await agentBindingForJob(job, latest);
    const mockId = binding.agentId || mockAgentIdForJob(job);
    if (!binding.agentId) {
      await saveAgentBindingForJob(job, mockId, "mock");
    }
    await patchJob(job.id, latest.id, {
      status: "dispatched",
      cursorAgentId: mockId,
      cursorRunId: mockRunId(job.id),
      cursorHttpStatus: 200,
      cursorBody: { mock: true, id: mockId },
      event: { type: "dispatch", detail: "Simulated dispatch (no Cursor API key for this workspace)" },
    });
    const { runMockAgent } = await import("@/lib/mock-agent");
    const message = await runMockAgent(latest, job, workspace);
    const { settleJob } = await import("@/lib/settle");
    await settleJob(job.id, latest.id, { message });
    return { user: latest, agentId: mockId, mock: true };
  }

  // Pocketedge API clients (externalId) share the company workspace — no per-user GitHub repo.
  const withRepo = Boolean(rt.githubToken) && !latest.externalId;
  let current = latest;
  let skillsInRepo = false;
  if (withRepo) {
    current = await ensurePersonalRepo(latest);
    if (!current.agentRepository) {
      await failJob(job, current.id, current.provisionError || "Personal repo missing");
      throw new Error(current.provisionError || "Personal repo missing");
    }
    try {
      skillsInRepo = Boolean(await syncWorkspaceSkills(current, workspace));
      current = (await getUser(current.id)) ?? current;
    } catch {
      // fall back to inlining the skills in the prompt
    }
  }
  const hash = `${skillsHash(workspace)}:${withRepo ? "repo" : "no-repo"}`;
  const mcp = await buildMcpServers(current, job, workspace, rt, withRepo);
  const promptText = await buildPersonalAgentPrompt(current, job, {
    agentTools: mcp.agentTools,
    vaultTools: mcp.vaultTools,
    zerodha: mcp.zerodha,
    skillsInRepo,
    companyServers: mcp.companyServers,
    connections: mcp.connections,
  });

  // One Cursor agent per chat thread; replace only when skills or repo mode changed.
  const binding = await agentBindingForJob(job, current);
  if (binding.agentId && binding.skillsHash === hash) {
    const run = await createRun(rt.cursorApiKey, binding.agentId, promptText, mcp.servers);
    const runId = run.ok ? extractRunId(run.body) : undefined;
    if (runId) {
      await patchJob(job.id, current.id, {
        status: "dispatched",
        cursorAgentId: binding.agentId,
        cursorRunId: runId,
        cursorHttpStatus: run.status,
        cursorBody: run.body,
        event: { type: "dispatch", detail: `New run on agent ${binding.agentId}` },
      });
      return { user: current, agentId: binding.agentId, mock: false };
    }
    if (run.status === 409) {
      await failJob(job, current.id, "Your agent is still working on the previous message. Try again when it replies.");
      return { user: current, agentId: binding.agentId, mock: false };
    }
    // Agent expired or was removed: start a fresh one below.
  }

  const created = await createAgent(
    rt.cursorApiKey,
    withRepo ? current : undefined,
    promptText,
    mcp.servers,
  );
  await saveAgentBindingForJob(job, created.agentId, hash);
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

/** `repoUser` set: the agent works in that user's repo. Unset: a no-repo agent. */
async function createAgent(
  key: string,
  repoUser: PersonalUser | undefined,
  promptText: string,
  mcpServers: McpServerDef[],
) {
  const cfg = getConfig();
  const repository = repoUser?.agentRepository;

  const v1 = await cursorPost(key, "/v1/agents", {
    prompt: { text: promptText },
    ...(repository
      ? {
          repos: [{ url: repository, startingRef: repoUser.agentRef || "main" }],
          autoCreatePR: false,
          skipReviewerRequest: true,
        }
      : {}),
    mcpServers,
  });
  const v1Id = extractAgentId((v1.body as { agent?: unknown })?.agent) || extractAgentId(v1.body);
  if (v1.ok && v1Id) {
    return { agentId: v1Id, runId: extractRunId(v1.body), status: v1.status, body: v1.body };
  }
  if (!repository) {
    throw new Error(`Cursor create failed (HTTP ${v1.status}): ${JSON.stringify(v1.body).slice(0, 400)}`);
  }

  const v0Body: Record<string, unknown> = {
    prompt: { text: promptText },
    source: { repository, ref: repoUser.agentRef || "main" },
    target: { autoCreatePr: false },
  };
  if (cfg.cursorStatusWebhookUrl && cfg.cursorStatusWebhookSecret) {
    v0Body.webhook = { url: cfg.cursorStatusWebhookUrl, secret: cfg.cursorStatusWebhookSecret };
  }
  const result = await cursorPost(key, "/v0/agents", v0Body);
  const agentId = extractAgentId(result.body);
  if (!result.ok || !agentId) {
    throw new Error(`Cursor create failed: ${JSON.stringify(v1.body || result.body).slice(0, 400)}`);
  }
  return { agentId, runId: undefined as string | undefined, status: result.status, body: result.body };
}

export async function fetchFinalAssistantMessage(ownerUserId: string, agentId: string, runId?: string) {
  if (agentId.startsWith("mock-")) {
    return "Mock agent completed.";
  }
  const key = (await runtimeForUserId(ownerUserId)).cursorApiKey;
  if (runId) {
    try {
      const run = await getRun(key, agentId, runId);
      if (run.result?.trim()) return run.result.trim();
    } catch {
      // fall back to the v0 conversation below
    }
  }
  const conversation = await getAgentConversation(key, agentId);
  const messages = conversation.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const role = (m.type || m.role || "").toLowerCase();
    if (role.includes("assistant") || role === "ai_message") {
      if (m.text?.trim()) return m.text.trim();
    }
  }
  const agent = await getAgent(key, agentId);
  return `Agent status: ${agent.status || "unknown"}`;
}
