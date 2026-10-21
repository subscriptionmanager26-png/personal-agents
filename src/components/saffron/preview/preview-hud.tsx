"use client";

import { useEffect, useState } from "react";

export function SaffronPreviewHud() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setTime(
        `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} UTC`,
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[25] hidden md:block" aria-hidden>
      <div className="absolute top-24 left-10 font-mono text-[10px] text-white/25">
        <p>SAFFRON // HORIZON</p>
        <p className="text-white/40">{time}</p>
        <p className="mt-2">φ 19.0760° N · λ 72.8777° E</p>
      </div>
    </div>
  );
}
