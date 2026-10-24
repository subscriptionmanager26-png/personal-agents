import type { StoreData } from "@/lib/types";

export function emptyStoreData(): StoreData {
  return {
    users: {},
    files: {},
    workspaces: {},
    memories: {},
    vaultItems: {},
    connections: {},
    orders: {},
    jobs: [],
    webThreads: {},
    slackThreads: {},
    slackInstalls: {},
    processedSlackMessages: [],
    auditEvents: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Merge persisted JSON into a safe in-memory shape (null arrays/objects break listing). */
export function coerceStoreData(partial: unknown): StoreData {
  const base = emptyStoreData();
  if (!partial || typeof partial !== "object") return base;
  const input = partial as Partial<StoreData>;
  return {
    ...base,
    ...input,
    users: record(input.users) as StoreData["users"],
    files: record(input.files) as StoreData["files"],
    workspaces: record(input.workspaces) as StoreData["workspaces"],
    memories: record(input.memories) as StoreData["memories"],
    vaultItems: record(input.vaultItems) as StoreData["vaultItems"],
    connections: record(input.connections) as StoreData["connections"],
    orders: record(input.orders) as StoreData["orders"],
    jobs: Array.isArray(input.jobs) ? input.jobs : [],
    webThreads: record(input.webThreads) as StoreData["webThreads"],
    slackThreads: record(input.slackThreads) as StoreData["slackThreads"],
    slackInstalls: record(input.slackInstalls) as StoreData["slackInstalls"],
    processedSlackMessages: Array.isArray(input.processedSlackMessages) ? input.processedSlackMessages : [],
    auditEvents: Array.isArray(input.auditEvents) ? input.auditEvents : [],
  };
}
