import { Cinzel, Cormorant_Garamond } from "next/font/google";

import { SaffronScene } from "@/components/saffron/saffron-scene";
import { VaultMonolith } from "@/components/saffron/vault-monolith";

const display = Cinzel({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-saffron-display",
});

const body = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-saffron-body",
});

export function SaffronLanding() {
  return (
    <div
      className={`${display.variable} ${body.variable} relative min-h-screen overflow-hidden bg-[#06070c] text-[#e8e4dc]`}
    >
      <SaffronScene />

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(201,162,39,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(201,162,39,0.5) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
        aria-hidden
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-12">
        <p
          className="font-[family-name:var(--font-saffron-display)] text-sm tracking-[0.35em] text-[#d4af37] uppercase"
        >
          Saffron AI
        </p>
        <a
          href="mailto:hello@saffronai.in"
          className="font-[family-name:var(--font-saffron-body)] text-sm tracking-wide text-[#a8b8d0] transition-colors hover:text-[#f0d78a]"
        >
          Contact
        </a>
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 pb-20 pt-4 md:flex-row md:items-center md:gap-16 md:px-12 md:pt-8">
        <div className="relative w-full max-w-[280px] shrink-0 md:max-w-[320px]">
          <div
            className="absolute -inset-8 rounded-full bg-[radial-gradient(circle,rgba(212,175,95,0.15),transparent_70%)] blur-2xl"
            aria-hidden
          />
          <VaultMonolith className="relative w-full drop-shadow-[0_0_40px_rgba(201,162,39,0.15)]" />
        </div>

        <div className="mt-10 max-w-xl text-center md:mt-0 md:text-left">
          <p className="font-[family-name:var(--font-saffron-body)] text-lg tracking-[0.2em] text-[#7a90b0] uppercase">
            At the edge of certainty
          </p>
          <h1
            className="mt-4 font-[family-name:var(--font-saffron-display)] text-4xl leading-tight tracking-wide text-[#f5f0e6] md:text-5xl lg:text-6xl"
          >
            Intelligence held
            <span className="block bg-gradient-to-r from-[#f0d78a] via-[#d4af37] to-[#8ec4ff] bg-clip-text text-transparent">
              in the vault
            </span>
          </h1>
          <p className="mt-6 font-[family-name:var(--font-saffron-body)] text-xl leading-relaxed text-[#b8c0d0] md:text-2xl">
            Saffron AI builds systems where deep models meet disciplined judgment — monolithic in purpose,
            luminous at the horizon.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4 md:justify-start">
            <a
              href="mailto:hello@saffronai.in"
              className="rounded-sm border border-[#c9a227]/60 bg-[#c9a227]/10 px-6 py-3 font-[family-name:var(--font-saffron-display)] text-xs tracking-[0.25em] text-[#f0d78a] uppercase transition-colors hover:border-[#f0d78a] hover:bg-[#c9a227]/20"
            >
              Begin transmission
            </a>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-[#c9a227]/10 px-6 py-8 md:px-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
          <p className="font-[family-name:var(--font-saffron-body)] text-sm text-[#6a7588]">
            Sacred geometry. Relativistic light. Built for what comes after the empire falls.
          </p>
          <p className="font-[family-name:var(--font-saffron-display)] text-[10px] tracking-[0.3em] text-[#4a5568] uppercase">
            © {new Date().getFullYear()} Saffron AI
          </p>
        </div>
      </footer>
    </div>
  );
}
