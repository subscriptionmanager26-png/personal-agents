import { NextResponse } from "next/server";

import { getJob } from "@/lib/jobs";
import { revealVaultItem, verifyVaultJobToken } from "@/lib/vault";

type InjectSpec = {
  header?: string;
  scheme?: "Bearer" | "Basic" | "Raw";
  /** Query param name to inject into (alternative to header). */
  query?: string;
};

/**
 * Model-blind vault use (Hermes / OpenInstinct style).
 * Resolves the secret server-side, injects it into an outbound HTTP call,
 * and returns only the upstream response with secret material scrubbed.
 * The plaintext secret is never included in the JSON response.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 401 });
  }

  let claims;
  try {
    claims = await verifyVaultJobToken(token);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const job = await getJob(claims.jobId);
  if (!job || job.ownerUserId !== claims.ownerUserId) {
    return NextResponse.json({ error: "job mismatch" }, { status: 403 });
  }
  if (job.status === "replied" || job.status === "error") {
    return NextResponse.json({ error: "job closed" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    handle?: string;
    label?: string;
    action?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    inject?: InjectSpec;
  };

  if (body.action && body.action !== "http") {
    return NextResponse.json(
      {
        error:
          "unsupported action — only action=http is allowed (model-blind). Plaintext reveal is disabled.",
      },
      { status: 400 },
    );
  }

  if (!body.handle && !body.label) {
    return NextResponse.json(
      { error: "handle or label required" },
      { status: 400 },
    );
  }
  if (!body.url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(body.url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return NextResponse.json({ error: "url must be http(s)" }, { status: 400 });
  }

  const item = await revealVaultItem({
    ownerUserId: claims.ownerUserId,
    jobId: claims.jobId,
    itemId: body.handle,
    label: body.label,
  });
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Origin binding (when set): only allow requests to that host.
  if (item.origin) {
    try {
      const bound = new URL(item.origin);
      if (bound.host !== targetUrl.host) {
        return NextResponse.json(
          {
            error: "origin_mismatch",
            detail: `Credential bound to ${bound.host}, refused ${targetUrl.host}`,
          },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json({ error: "invalid bound origin" }, { status: 500 });
    }
  }

  const inject = body.inject || { header: "Authorization", scheme: "Bearer" };
  const outboundHeaders = new Headers(body.headers || {});
  // Strip any attempt by the model to supply the secret itself.
  for (const key of [...outboundHeaders.keys()]) {
    if (/authorization|api[-_]?key|x-api-key|cookie/i.test(key)) {
      outboundHeaders.delete(key);
    }
  }

  if (inject.query) {
    targetUrl.searchParams.set(inject.query, item.secret);
  } else {
    const headerName = inject.header || "Authorization";
    const scheme = inject.scheme || "Bearer";
    if (scheme === "Basic") {
      const user = item.username || "";
      const encoded = Buffer.from(`${user}:${item.secret}`, "utf8").toString(
        "base64",
      );
      outboundHeaders.set(headerName, `Basic ${encoded}`);
    } else if (scheme === "Raw") {
      outboundHeaders.set(headerName, item.secret);
    } else {
      outboundHeaders.set(headerName, `Bearer ${item.secret}`);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: (body.method || "GET").toUpperCase(),
      headers: outboundHeaders,
      body: body.body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: "upstream_failed", detail: scrub(message, item.secret) },
      { status: 502 },
    );
  }

  const rawText = await upstream.text();
  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (/set-cookie|authorization/i.test(key)) return;
    responseHeaders[key] = scrub(value, item.secret);
  });

  return NextResponse.json({
    ok: true,
    handle: item.id,
    label: item.label,
    origin: item.origin,
    upstream: {
      status: upstream.status,
      headers: responseHeaders,
      body: scrub(rawText, item.secret).slice(0, 100_000),
    },
  });
}

function scrub(text: string, secret: string) {
  if (!secret) return text;
  let out = text.split(secret).join("[REDACTED]");
  // Also scrub URL-encoded / base64-ish variants of the same secret.
  try {
    out = out.split(encodeURIComponent(secret)).join("[REDACTED]");
  } catch {
    // ignore
  }
  return out;
}
