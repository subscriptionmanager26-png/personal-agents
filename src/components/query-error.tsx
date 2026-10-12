"use client";

import { useSearchParams } from "next/navigation";

/** Shows `?error=` from the URL; for places (like layouts) that cannot read searchParams. */
export function QueryError() {
  const error = useSearchParams().get("error");
  if (!error) return null;
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}
