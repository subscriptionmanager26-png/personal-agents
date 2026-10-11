export type MemoryKind = "preference" | "fact" | "note" | "research_summary";

export type JobStatus =
  | "queued"
  | "dispatched"
  | "delivering"
  | "replied"
  | "error";

export type JobSource = "web" | "slack";

export type PersonalUser = {
  /** Canonical tenancy key: `email:{normalizedEmail}` (legacy: `slack:{team}:{user}`). */
  id: string;
  email?: string;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  /** Optional Slack binding if the user later connects Slack. */
  slackTeamId?: string;
  slackUserId?: string;
  agentRepository?: string;
  agentRef: string;
  cursorAgentId?: string;
  enabledSkillIds: string[];
  provisionError?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type MemoryEntry = {
  id: string;
  ownerUserId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  pinned?: boolean;
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
  cursorHttpStatus?: number;
  cursorBody?: unknown;
  reply?: {
    message: string;
    receivedAt: string;
    slackMessageTs?: string;
  };
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

export type SkillCatalogEntry = {
  id: string;
  name: string;
  description: string;
  /** Relative path under skills-catalog/ */
  path: string;
  /** Path inside the personal agent repo */
  installPath: string;
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
  memories: Record<string, MemoryEntry[]>;
  vaultItems: Record<string, VaultItem[]>;
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
