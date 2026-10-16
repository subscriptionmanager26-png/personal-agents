/** Hostnames that serve Pocketedge ops only (email login, no client signup). */
export function adminHosts() {
  return (process.env.ADMIN_HOSTS || "agents.pocketedge.in,studio.pocketedge.in")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminHost(host: string | null | undefined) {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return adminHosts().includes(name);
}
