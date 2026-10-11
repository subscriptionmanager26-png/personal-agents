"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Soft-refresh the chat page while a job is still running. */
export function ChatRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [active, router]);

  return null;
}
