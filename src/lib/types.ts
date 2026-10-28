/** Agent-chosen category (e.g. "preference", "goal", "holding", "episode"). */
export type MemoryKind = string;

export type JobStatus =
  | "queued"
  | "dispatched"
  | "delivering"
  | "replied"
  | "error";

export type JobSource = "web" | "slack" | "api";

/** Structured content the company's UI renders with its own components. */
export type UiBlock =
  | { kind: "markdown"; text: string }
  | {
      kind: "table";
      title?: string;
      /** percent cells are fractions: 0.125 renders as 12.5%. */
      columns: { key: string; label: string; format?: "text" | "number" | "currency" | "percent" }[];
      rows: Record<string, string | number | null>[];
    }
  | {
      kind: "chart";
      title?: string;
      chartType: "line" | "bar" | "area";
      xKey: string;
      series: { key: string; label: string }[];
      data: Record<string, string | number>[];
    }
  | {
      kind: "card";
      title: string;
      body?: string;
      tone?: "info" | "success" | "warning";
      fields?: { label: string; value: string }[];
    };

export type OrderSide = "BUY" | "SELL";

export type OrderRequest = {
  exchange: "NSE" | "BSE";
  symbol: string;
  side: OrderSide;
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  /** Required for LIMIT orders. */
  price?: number;
  product: "CNC" | "MIS";
};

export type OrderStatus = "proposed" | "rejected" | "executed" | "failed" | "expired";

export type OrderProposal = {
  id: string;
  ownerUserId: string;
  jobId: string;
  order: OrderRequest;
  rationale: string;
  status: OrderStatus;
  brokerOrderId?: string;
  outcomeMessage?: string;
  createdAt: string;
  decidedAt?: string;
};

export type PortfolioHoldingDraft = {
  ticker: string;
  qty: number;
  /** Average cost per unit in INR, when known. */
  avg?: number;
  name?: string;
};

export type ActionRequired =
  | { kind: "connection_login"; service: string; url: string; message?: string }
  | { kind: "order_confirmation"; orderId: string; order: OrderRequest; rationale: string; expiresAt: string }
  | {
      kind: "portfolio_confirmation";
      proposalId: string;
      mode: "replace" | "merge";
      holdings: PortfolioHoldingDraft[];
      summary: string;
      expiresAt: string;
    };

/** Ordered events for one message; `seq` doubles as the SSE event id. */
export type StreamEvent = { seq: number; at: string } & (
  | { type: "status"; label: string }
  | { type: "block"; block: UiBlock }
  | { type: "action_required"; action: ActionRequired }
  | { type: "done" }
  | { type: "error"; message: string }
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type StreamEventInput = DistributiveOmit<StreamEvent, "seq" | "at">;

export type UserRole = "owner" | "client";
export type MembershipStatus = "pending" | "active" | "suspended";

export type PersonalUser = {
  /** Canonical tenancy key: `email:{normalizedEmail}` (legacy: `slack:{team}:{user}`). */
  id: string;
  email?: string;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  /** Workspace this person belongs to: as its owner, or as one of its clients. */
  workspaceId?: string;
  role?: UserRole;
  /** Clients start pending; only active clients (and owners) can use an agent. */
  membershipStatus?: MembershipStatus;
  /** The company's own user id, for users created through the API. */
  externalId?: string;
  /** Optional Slack binding if the user later connects Slack. */
  slackTeamId?: string;
  slackUserId?: string;
  agentRepository?: string;
  agentRef: string;
  cursorAgentId?: string;
  /** Skills version the standing Cursor agent was created with. */
  cursorAgentSkillsHash?: string;
  /** Skills version last written to the personal repo. */
  skillsSyncedHash?: string;
  /** Vault MCP / environment files version last written to the personal repo. */
  runtimeSyncedHash?: string;
  enabledSkillIds: string[];
  provisionError?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type WorkspaceSkill = {
  id: string;
  /** Folder name under .cursor/skills/ in each client's repo. */
  slug: string;
  name: string;
  description: string;
  /** SKILL.md body written by the owner. */
  content: string;
  updatedAt: string;
};

export type SuggestedConnection = {
  id: string;
  name: string;
  url: string;
  description?: string;
  /** When set, clients must supply a value for this header (e.g. Authorization). */
  authHeader?: string;
};

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  /** Standing instructions for every client agent (tone, compliance, scope). */
  instructions: string;
  /** What agents should prioritise remembering about clients. */
  memoryGuidance: string;
  skills: WorkspaceSkill[];
  suggestedConnections: SuggestedConnection[];
  /** The company's MCP servers, attached to every user's agent with a signed user token. */
  companyServers?: CompanyServer[];
  apiKeys?: ApiKey[];
  /** Encrypted HS256 secret the company uses to verify per-user tokens. */
  mcpSigningSecretEnc?: string;
  /** The workspace's own Cursor and GitHub credentials; env vars are the fallback. */
  runtime?: AgentRuntimeSettings;
  createdAt: string;
  updatedAt: string;
};

export type AgentRuntimeSettings = {
  cursorApiKeyEnc?: string;
  /** Who the key belongs to, from Cursor, e.g. "ops@finco.com · key …a1b2". */
  cursorKeyLabel?: string;
  githubTokenEnc?: string;
  githubTokenLabel?: string;
  /** Org for client repos; blank means the token's own account. */
  githubOrg?: string;
  /** Public base URL of this app that Cursor's cloud can reach (tools, files, memory). */
  agentPublicUrl?: string;
  updatedAt?: string;
};

export type CompanyServer = {
  id: string;
  /** MCP server name shown to the agent. */
  name: string;
  url: string;
  description?: string;
};

export type ApiKey = {
  id: string;
  label: string;
  /** sha256 of the secret part, hex. */
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type McpConnection = {
  id: string;
  ownerUserId: string;
  /** MCP server name shown to the agent; unique per user. */
  name: string;
  url: string;
  headerName?: string;
  headerValueEnc?: string;
  suggestionId?: string;
  /** Built-in integration reached through our own proxy rather than by URL. */
  builtin?: "kite";
  /** Kite MCP session id, encrypted: whoever holds it acts on the client's Zerodha login. */
  sessionEnc?: string;
  sessionStartedAt?: string;
  createdAt: string;
};

export type MemoryEntry = {
  id: string;
  ownerUserId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  /** 1 (trivia) – 5 (critical); the agent decides. */
  importance: number;
  pinned?: boolean;
  source?: "agent" | "user" | "auto";
  sourceJobId?: string;
  createdAt: string;
  updatedAt: string;
};

export type VaultItem = {
  id: string;
  ownerUserId: string;
  label: string;
  username?: string;
  /** Optional host binding (Hermes-style). When set, vault/use only allows that origin. */
  origin?: string;
  ciphertext: string; // base64url iv+tag+data
  createdAt: string;
  updatedAt: string;
};

export type Job = {
  id: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  source: JobSource;
  /** Slack fields — only required when source === "slack". */
  slackTeamId?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  slackUserId?: string;
  slackMessageTs?: string;
  /** Web chat thread key when source === "web". */
  webThreadId?: string;
  prompt: string;
  /** The client's uploaded files attached to this message, as they were when sent. */
  attachments?: JobAttachment[];
  threadContext?: string;
  status: JobStatus;
  cursorAgentId?: string;
  /** v1 run id for this job; used for the live trace stream and run result. */
  cursorRunId?: string;
  cursorHttpStatus?: number;
  cursorBody?: unknown;
  reply?: {
    message: string;
    receivedAt: string;
    slackMessageTs?: string;
  };
  /** Memory writes the agent made through the memory tools during this job. */
  memoryWrites?: number;
  error?: string;
  events: { at: string; type: string; detail: string }[];
  /** What the company's UI shows for this message, in order. */
  stream?: StreamEvent[];
};

export type SlackThreadRef = {
  ownerUserId: string;
  channelId: string;
  threadTs: string;
  lastJobId?: string;
  updatedAt: string;
  /** One Cursor cloud agent per Slack thread. */
  cursorAgentId?: string;
  cursorAgentSkillsHash?: string;
};

/** Web / API chat thread — each thread owns one Cursor agent. */
export type WebThread = {
  id: string;
  ownerUserId: string;
  source: "web" | "api";
  title: string;
  cursorAgentId?: string;
  cursorAgentSkillsHash?: string;
  /** True while any job on this thread is queued/dispatched/delivering. */
  working?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SlackWorkspaceInstall = {
  teamId: string;
  teamName?: string;
  botTokenEnc: string;
  botUserId: string;
  installedByUserId?: string;
  scopes?: string[];
  installedAt: string;
  isActive: boolean;
  uninstalledAt?: string;
};

export type SkillTemplate = {
  id: string;
  name: string;
  description: string;
  /** Relative path under skills-catalog/ */
  path: string;
};

export type AuditEvent = {
  id: string;
  at: string;
  ownerUserId?: string;
  type: string;
  detail: string;
};

export type FileKind = "pdf" | "csv" | "xlsx" | "image";

export type JobAttachment = { id: string; name: string; kind: FileKind; size: number };

export type SheetSummary = { name: string; rows: number; columns: number; header: string[] };

/** A file a client uploaded. Bytes and extracted content live in file storage, not here. */
export type UploadedFile = {
  id: string;
  ownerUserId: string;
  name: string;
  kind: FileKind;
  mimeType: string;
  size: number;
  sha256: string;
  /** `needs_password`: an encrypted PDF the client has not unlocked yet. */
  status: "ready" | "needs_password" | "failed";
  error?: string;
  pages?: number;
  sheets?: SheetSummary[];
  /** Characters of extracted text (PDF) or cells (tables). */
  extractedSize?: number;
  truncated?: boolean;
  createdAt: string;
};

export type StoreData = {
  users: Record<string, PersonalUser>;
  files: Record<string, UploadedFile[]>;
  workspaces: Record<string, Workspace>;
  memories: Record<string, MemoryEntry[]>;
  vaultItems: Record<string, VaultItem[]>;
  connections: Record<string, McpConnection[]>;
  orders: Record<string, OrderProposal[]>;
  jobs: Job[];
  webThreads: Record<string, WebThread>;
  slackThreads: Record<string, SlackThreadRef>;
  slackInstalls: Record<string, SlackWorkspaceInstall>;
  processedSlackMessages: string[];
  auditEvents: AuditEvent[];
};

export type SessionUser = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  slackTeamId?: string;
  slackUserId?: string;
};
