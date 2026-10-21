"use client";

/** Hero background: horizon ring only (no center prism strip). */
export function SaffronAmbientDeployment() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-black" />
      <div
        className="absolute top-[-20%] left-1/2 h-[min(140vh,1200px)] w-[min(140vh,1200px)] -translate-x-1/2 rounded-full opacity-90"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, transparent 0%, transparent 38%, rgba(255,255,255,0.04) 39%, transparent 42%, rgba(255,140,60,0.28) 44%, rgba(255,90,40,0.1) 48%, transparent 52%, rgba(80,140,255,0.07) 58%, transparent 70%)",
        }}
      />
      <div className="saffron-orbit absolute top-[18%] left-1/2 h-[min(72vw,520px)] w-[min(72vw,520px)] -translate-x-1/2 rounded-full border border-white/[0.08]" />
      <div className="absolute top-[32%] left-1/2 h-[min(22vw,160px)] w-[min(22vw,160px)] -translate-x-1/2 rounded-full bg-black shadow-[0_0_80px_35px_rgba(0,0,0,0.85)]" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />
    </div>
  );
}
