import { redirect } from "next/navigation";

import { connectKite, disconnectKite, kiteLogin } from "@/lib/kite";
import { requireAgentUser } from "@/lib/viewer";

function back(error?: string): never {
  redirect(error ? `/app/connections?error=${encodeURIComponent(error)}` : "/app/connections");
}

export async function POST(request: Request) {
  const { user } = await requireAgentUser();
  const action = String((await request.formData()).get("action") || "");

  if (action === "disconnect") {
    await disconnectKite(user.id);
    back();
  }
  if (action !== "connect" && action !== "login") back("Unknown Zerodha action.");

  if (action === "connect") await connectKite(user.id);
  let login: Awaited<ReturnType<typeof kiteLogin>>;
  try {
    login = await kiteLogin(user.id);
  } catch (error) {
    back(error instanceof Error ? error.message : "Could not reach Zerodha.");
  }
  if ("url" in login) redirect(login.url);
  back();
}
