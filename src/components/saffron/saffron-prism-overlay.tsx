"use client";

/** Deployment.inc-style chromatic prism column on black. */
export function SaffronPrismOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden opacity-[0.85] mix-blend-screen"
      aria-hidden
    >
      <div className="absolute top-[-6%] left-1/2 h-[110vh] w-[min(26vw,300px)] -translate-x-1/2">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-300/35 via-amber-100/20 to-rose-500/30 blur-[0.5px]" />
        <div className="absolute inset-x-[36%] inset-y-0 bg-gradient-to-b from-white/35 via-violet-200/10 to-orange-400/20 blur-md" />
      </div>
      <div className="saffron-scanlines absolute inset-0 opacity-[0.03]" />
    </div>
  );
}
