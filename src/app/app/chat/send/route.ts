import { redirect } from "next/navigation";

import { enqueueWebChat } from "@/lib/dispatch-web";
import { getSession } from "@/lib/session";
import { getUser } from "@/lib/users";

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) redirect("/");

  const user = await getUser(session.id);
  if (!user) redirect("/");

  const form = await request.formData();
  const text = String(form.get("text") || "").trim();
  const attachments = form.getAll("attachments").map(String).filter(Boolean);
  if (!text && !attachments.length) redirect("/app/chat");

  try {
    const { job } = await enqueueWebChat({ user, text, attachments });
    redirect(`/app/chat?job=${encodeURIComponent(job.id)}`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    redirect(`/app/chat?error=${encodeURIComponent(message)}`);
  }
}
