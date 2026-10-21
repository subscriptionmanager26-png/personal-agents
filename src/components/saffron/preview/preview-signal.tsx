"use client";

import { useEffect, useState } from "react";

const LINES = [
  "> vault.handle.materialize(tenant:slack:…)",
  "> memory.compact — 128k tokens retained",
  "> agent.run — cursor cloud",
];

export function SaffronPreviewSignal() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    let i = 0;
    const id = window.setInterval(() => {
      setLines((prev) => [...prev.slice(-4), LINES[i % LINES.length]]);
      i += 1;
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-5 font-mono text-[11px] text-emerald-400/70 backdrop-blur-md">
      <p className="mb-3 text-[10px] tracking-[0.35em] text-white/30 uppercase">Live signal</p>
      {lines.map((line, idx) => (
        <p key={`${line}-${idx}`} className="text-white/50">{line}</p>
      ))}
    </div>
  );
}
