import { listConnections } from "@/lib/connections";
import { getKiteConnection, kiteLoggedInAs } from "@/lib/kite";
import { kiteMcpAuthErrorMessage, kiteMcpBearer } from "@/lib/kite-mcp-oauth";
import { listVaultItems } from "@/lib/vault";

export type ApiConnectionsView = {
  zerodha: {
    connected: boolean;
    loggedInAs: string | null;
    sessionActive: boolean;
    /** Hosted mcp.kite.trade operator token (backend); without this Connect/Login always fails. */
    mcpBackendReady: boolean;
    mcpBackendMessage: string | null;
  };
  mcp: Awaited<ReturnType<typeof listConnections>>;
  vaultCount: number;
};

export async function apiConnectionsView(ownerUserId: string): Promise<ApiConnectionsView> {
  const [mcp, vault, kiteConn, mcpBearer, mcpBackendMessage] = await Promise.all([
    listConnections(ownerUserId),
    listVaultItems(ownerUserId),
    getKiteConnection(ownerUserId),
    kiteMcpBearer(),
    kiteMcpAuthErrorMessage(),
  ]);
  let loggedInAs: string | null = null;
  if (kiteConn) {
    // Don't hang the whole status on a slow MCP probe (PA↔Kite can be cross-region).
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
    loggedInAs =
      (await Promise.race([kiteLoggedInAs(ownerUserId).catch(() => null), timeout])) ?? null;
  }
  return {
    zerodha: {
      connected: Boolean(kiteConn),
      loggedInAs,
      sessionActive: Boolean(loggedInAs),
      mcpBackendReady: Boolean(mcpBearer),
      mcpBackendMessage: mcpBearer ? null : mcpBackendMessage ?? "Zerodha MCP backend is not configured.",
    },
    mcp,
    vaultCount: vault.length,
  };
}
