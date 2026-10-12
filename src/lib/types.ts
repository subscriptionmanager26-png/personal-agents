/** Agent-chosen category (e.g. "preference", "goal", "holding", "episode"). */
export type MemoryKind = string;

export type JobStatus =
  | "queued"
  | "dispatched"
  | "delivering"
  | "replied"
  | "error";

export type JobSource = "web" | "slack";

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
  createdAt: string;
  updatedAt: string;
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
};

export type SlackThreadRef = {
  ownerUserId: string;
  channelId: string;
  threadTs: string;
  lastJobId?: string;
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

export type StoreData = {
  users: Record<string, PersonalUser>;
  workspaces: Record<string, Workspace>;
  memories: Record<string, MemoryEntry[]>;
  vaultItems: Record<string, VaultItem[]>;
  connections: Record<string, McpConnection[]>;
  jobs: Job[];
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
