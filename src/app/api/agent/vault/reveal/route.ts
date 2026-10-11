import { NextResponse } from "next/server";

/**
 * Plaintext reveal is disabled.
 * Agents must use POST /api/agent/vault/use (model-blind HTTP injection).
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "plaintext_reveal_disabled",
      detail:
        "Secrets are model-blind. Use POST /api/agent/vault/use with action=http so the control plane injects the secret server-side.",
    },
    { status: 410 },
  );
}
