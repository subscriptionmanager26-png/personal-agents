"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import { SaffronMark } from "@/components/saffron/saffron-mark";

/**
 * Cinematic hero field: prism light column + horizon ring + subtle pointer parallax.
 */
export function SaffronAmbient() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (e: PointerEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      root.style.setProperty("--saffron-px", `${x * 14}px`);
      root.style.setProperty("--saffron-py", `${y * 10}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ "--saffron-px": "0px", "--saffron-py": "0px" } as CSSProperties}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[#020203]" />

      {/* Chromatic prism column (Deployment-inspired) */}
      <div
        className="absolute top-[-5%] left-1/2 h-[115vh] w-[min(32vw,380px)] -translate-x-1/2 opacity-80"
        style={{ transform: "translate(calc(-50% + var(--saffron-px)), var(--saffron-py))" }}
      >
        <div className="saffron-prism-pulse absolute inset-0 blur-[1px] bg-gradient-to-b from-cyan-300/25 via-amber-200/20 to-rose-500/30 mix-blend-screen" />
        <div className="absolute inset-0 bg-gradient-to-b from-sky-400/10 via-white/5 to-orange-500/15 blur-3xl" />
        <div className="absolute inset-x-[35%] inset-y-0 bg-gradient-to-b from-white/25 via-amber-100/15 to-transparent blur-md" />
      </div>

      {/* Event horizon */}
      <div
        className="absolute top-[8%] left-1/2 h-[min(78vw,560px)] w-[min(78vw,560px)] -translate-x-1/2 rounded-full opacity-90"
        style={{ transform: "translate(calc(-50% + var(--saffron-px) * 0.5), calc(var(--saffron-py) * 0.5))" }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 45%, transparent 36%, rgba(255,255,255,0.05) 38%, transparent 41%, rgba(255,120,50,0.4) 43.5%, rgba(255,80,30,0.15) 47%, transparent 52%, rgba(90,150,255,0.12) 58%, transparent 68%)",
          }}
        />
        <div className="saffron-orbit absolute inset-[8%] rounded-full border border-white/[0.07]" />
        <div className="saffron-orbit saffron-orbit--delay absolute inset-[18%] rounded-full border border-orange-300/15" />
      </div>

      <div
        className="absolute top-[28%] left-1/2 h-[min(22vw,168px)] w-[min(22vw,168px)] -translate-x-1/2 rounded-full bg-black shadow-[0_0_100px_40px_rgba(0,0,0,0.95),0_0_140px_60px_rgba(255,90,40,0.14)]"
        style={{ transform: "translate(calc(-50% + var(--saffron-px) * 0.3), calc(var(--saffron-py) * 0.3))" }}
      />

      <div
        className="absolute top-[22%] left-1/2 -translate-x-1/2"
        style={{ transform: "translate(calc(-50% + var(--saffron-px) * 0.2), calc(8px + var(--saffron-py) * 0.2))" }}
      >
        <SaffronMark className="h-16 w-16 drop-shadow-[0_0_24px_rgba(255,255,255,0.25)] md:h-20 md:w-20" />
      </div>

      <div
        className="absolute inset-0 opacity-[0.32]"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% -10%, rgba(100,160,255,0.14), transparent 55%), radial-gradient(ellipse 50% 40% at 85% 70%, rgba(255,100,50,0.06), transparent)",
        }}
      />

      <div
        className="saffron-grain absolute inset-0 opacity-[0.055]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#020203] via-[#020203]/90 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#020203]/80 to-transparent" />
    </div>
  );
}
