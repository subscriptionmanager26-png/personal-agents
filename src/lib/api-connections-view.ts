import { listConnections } from "@/lib/connections";
import { getKiteConnection, kiteLoggedInAs } from "@/lib/kite";
import { listVaultItems } from "@/lib/vault";

export type ApiConnectionsView = {
  zerodha: {
    connected: boolean;
    loggedInAs: string | null;
    sessionActive: boolean;
  };
  mcp: Awaited<ReturnType<typeof listConnections>>;
  vaultCount: number;
};

export async function apiConnectionsView(ownerUserId: string): Promise<ApiConnectionsView> {
  const [mcp, vault, kiteConn] = await Promise.all([
    listConnections(ownerUserId),
    listVaultItems(ownerUserId),
    getKiteConnection(ownerUserId),
  ]);
  let loggedInAs: string | null = null;
  if (kiteConn) {
    // Same as studio connections page — don't hang the whole status on a slow MCP probe.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000));
    loggedInAs = await Promise.race([
      kiteLoggedInAs(ownerUserId).catch(() => null),
      timeout,
    ]);
  }
  return {
    zerodha: {
      connected: Boolean(kiteConn),
      loggedInAs,
      sessionActive: Boolean(loggedInAs),
    },
    mcp,
    vaultCount: vault.length,
  };
}
