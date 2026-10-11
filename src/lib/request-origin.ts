import { getConfig } from "@/lib/config";

/**
 * Browser-reachable origin for redirects.
 * Never return 0.0.0.0 — Next binds there, but cookies/browsers use 127.0.0.1/localhost.
 */
export function requestOrigin(request: Request) {
  const configured = getConfig().publicUrl.replace(/\/$/, "");
  if (configured && !configured.includes("0.0.0.0")) {
    return configured;
  }

  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "";
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") || host.startsWith("127.")
      ? "http"
      : "https");

  if (host && !host.startsWith("0.0.0.0")) {
    return `${proto}://${host}`;
  }

  try {
    const url = new URL(request.url);
    if (url.hostname === "0.0.0.0") {
      url.hostname = "127.0.0.1";
    }
    return url.origin;
  } catch {
    return "http://127.0.0.1:43149";
  }
}
