import { redirect } from "next/navigation";

import { addConnection } from "@/lib/connections";
import { requireAgentUser } from "@/lib/viewer";

export async function POST(request: Request) {
  const { user, workspace } = await requireAgentUser();
  const form = await request.formData();
  const headerValue = String(form.get("headerValue") || "");

  const suggestionId = String(form.get("suggestionId") || "");
  let input: Parameters<typeof addConnection>[0];
  if (suggestionId) {
    const suggestion = workspace?.suggestedConnections.find((s) => s.id === suggestionId);
    if (!suggestion) redirect(`/app/connections?error=${encodeURIComponent("That integration is no longer offered.")}`);
    input = {
      ownerUserId: user.id,
      name: suggestion.name,
      url: suggestion.url,
      headerName: suggestion.authHeader,
      headerValue: suggestion.authHeader ? headerValue : undefined,
      suggestionId,
    };
  } else {
    input = {
      ownerUserId: user.id,
      name: String(form.get("name") || ""),
      url: String(form.get("url") || ""),
      headerName: String(form.get("headerName") || ""),
      headerValue,
    };
  }

  const result = await addConnection(input);
  if ("error" in result) redirect(`/app/connections?error=${encodeURIComponent(result.error ?? "")}`);
  redirect("/app/connections");
}
