import { decryptSecret, encryptSecret, randomId } from "@/lib/crypto";
import { getStore, updateStore } from "@/lib/store";
import type { McpConnection } from "@/lib/types";
import { appendAudit } from "@/lib/users";
import { normalizeMcpUrl, slugify } from "@/lib/workspaces";

const PURPOSE = "mcp-connection";
/** Names the control plane uses for its own MCP servers. */
export const RESERVED_MCP_NAMES = new Set(["personal-vault", "personal-memory"]);
const HEADER_NAME = /^[A-Za-z0-9-]{1,60}$/;

export type PublicConnection = Omit<McpConnection, "headerValueEnc"> & { hasSecret: boolean };

function toPublic({ headerValueEnc, ...rest }: McpConnection): PublicConnection {
  return { ...rest, hasSecret: Boolean(headerValueEnc) };
}

export async function listConnections(ownerUserId: string): Promise<PublicConnection[]> {
  const store = await getStore();
  return (store.connections[ownerUserId] ?? [])
    .filter((c) => c.ownerUserId === ownerUserId)
    .map(toPublic);
}

export async function addConnection(input: {
  ownerUserId: string;
  name: string;
  url: string;
  headerName?: string;
  headerValue?: string;
  suggestionId?: string;
}) {
  const url = normalizeMcpUrl(input.url);
  if (!url) return { error: "Enter a valid http(s) MCP server URL." } as const;
  let name = slugify(input.name, 40);
  if (!name) return { error: "Give the connection a name." } as const;
  if (RESERVED_MCP_NAMES.has(name)) name = `${name}-2`;
  const headerName = input.headerName?.trim();
  const headerValue = input.headerValue?.trim();
  if (headerValue && (!headerName || !HEADER_NAME.test(headerName))) {
    return { error: "Header name may only contain letters, numbers and dashes." } as const;
  }

  const connection: McpConnection = {
    id: randomId("conn"),
    ownerUserId: input.ownerUserId,
    name,
    url,
    headerName: headerValue ? headerName : undefined,
    headerValueEnc: headerValue ? encryptSecret(headerValue, PURPOSE, input.ownerUserId) : undefined,
    suggestionId: input.suggestionId,
    createdAt: new Date().toISOString(),
  };
  const saved = await updateStore((store) => {
    const list = store.connections[input.ownerUserId] ?? [];
    if (list.some((c) => c.name === connection.name)) return false;
    list.push(connection);
    store.connections[input.ownerUserId] = list;
    return true;
  });
  if (!saved) return { error: "You already have a connection with that name." } as const;
  await appendAudit({ ownerUserId: input.ownerUserId, type: "connection.add", detail: `Added ${name} (${new URL(url).host})` });
  return { connection: toPublic(connection) } as const;
}

export async function deleteConnection(ownerUserId: string, id: string) {
  const ok = await updateStore((store) => {
    const list = store.connections[ownerUserId] ?? [];
    const next = list.filter((c) => !(c.id === id && c.ownerUserId === ownerUserId));
    store.connections[ownerUserId] = next;
    return next.length !== list.length;
  });
  if (ok) await appendAudit({ ownerUserId, type: "connection.delete", detail: `Removed ${id}` });
  return ok;
}

/**
 * Remote MCP definitions for Cursor. Header values are proxied by Cursor's backend
 * and never reach the agent VM or the prompt.
 */
export async function mcpServersForUser(ownerUserId: string) {
  const store = await getStore();
  return (store.connections[ownerUserId] ?? [])
    .filter((c) => c.ownerUserId === ownerUserId)
    .map((c) => ({
      name: c.name,
      type: "http" as const,
      url: c.url,
      ...(c.headerName && c.headerValueEnc
        ? { headers: { [c.headerName]: decryptSecret(c.headerValueEnc, PURPOSE, ownerUserId) } }
        : {}),
    }));
}
