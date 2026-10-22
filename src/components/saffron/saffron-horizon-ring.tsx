"use client";

/** Always-visible horizon / photon ring (CSS). Complements WebGL when subtle or unavailable. */
export function SaffronHorizonRing() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden" aria-hidden>
      <div
        className="absolute top-[-18%] left-1/2 h-[min(130vh,1100px)] w-[min(130vh,1100px)] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, transparent 0%, transparent 34%, rgba(255,255,255,0.12) 36.5%, rgba(255,200,120,0.55) 38.5%, rgba(255,120,50,0.45) 41%, rgba(255,80,30,0.18) 44%, transparent 48%, rgba(90,150,255,0.12) 54%, transparent 68%)",
        }}
      />
      <div
        className="absolute top-[14%] left-1/2 h-[min(78vw,560px)] w-[min(78vw,560px)] -translate-x-1/2 rounded-full"
        style={{
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.14), 0 0 42px 8px rgba(255,140,60,0.35), 0 0 90px 24px rgba(255,90,40,0.12)",
        }}
      />
      <div
        className="absolute top-[28%] left-1/2 h-[min(26vw,190px)] w-[min(26vw,190px)] -translate-x-1/2 rounded-full bg-black"
        style={{
          boxShadow: "0 0 70px 40px rgba(0,0,0,0.95), 0 0 120px 60px rgba(0,0,0,0.75)",
        }}
      />
    </div>
  );
}
