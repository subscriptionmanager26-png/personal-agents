function parseHostList(envValue: string | undefined, fallback: string) {
  return (envValue || fallback)
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Public marketing site for Saffron AI (separate from Pocketedge). */
export function saffronHosts() {
  const hosts = parseHostList(process.env.SAFFRON_HOSTS, "saffronai.in,www.saffronai.in");
  if (process.env.NODE_ENV === "development") {
    return [...hosts, "localhost", "127.0.0.1", "localhost:43149", "127.0.0.1:43149"];
  }
  return hosts;
}

export function isSaffronHost(host: string | null | undefined) {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return saffronHosts().includes(name);
}

/** Hostnames that serve Pocketedge ops only (email login, no client signup). */
export function adminHosts() {
  // agents.pocketedge.in is inbound mail (MX/SPF) — use studio or PUBLIC_URL for the console.
  return parseHostList(process.env.ADMIN_HOSTS, "studio.pocketedge.in");
}

export function isAdminHost(host: string | null | undefined) {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return adminHosts().includes(name);
}
