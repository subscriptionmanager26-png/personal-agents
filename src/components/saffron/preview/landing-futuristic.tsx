"use client";

import "../saffron-styles.css";

import { SaffronChrome } from "@/components/saffron/saffron-chrome";
import { SaffronDataBand } from "@/components/saffron/saffron-data-band";
import { SaffronHorizonGlInteractive } from "@/components/saffron/preview/horizon-gl-interactive";
import { SaffronPreviewHud } from "@/components/saffron/preview/preview-hud";
import { SaffronPreviewSignal } from "@/components/saffron/preview/preview-signal";
import { SaffronPrismOverlay } from "@/components/saffron/saffron-prism-overlay";
import { SaffronReveal } from "@/components/saffron/saffron-reveal";
import { SaffronRotatingPhrase } from "@/components/saffron/saffron-rotating-phrase";
import { SaffronMark } from "@/components/saffron/saffron-mark";

/** v2 — “100x futuristic” (WebGL + HUD + live signal + center mark). */
export function SaffronLandingFuturistic() {
  return (
    <div className="saffron-root relative min-h-screen overflow-x-hidden bg-[#010102] font-sans text-white antialiased">
      <SaffronHorizonGlInteractive />
      <div className="pointer-events-none fixed inset-0 z-[1] opacity-70 mix-blend-screen">
        <SaffronPrismOverlay />
      </div>
      <div className="saffron-vignette pointer-events-none fixed inset-0 z-[2]" aria-hidden />
      <SaffronPreviewHud />

      <SaffronChrome>
        <main className="relative z-10">
          <section className="relative flex min-h-[100svh] flex-col justify-end px-6 pb-20 pt-28 md:px-10 md:pb-24">
            <div className="pointer-events-none absolute top-[18%] left-1/2 z-0 -translate-x-1/2">
              <SaffronMark className="h-14 w-14 opacity-90 md:h-[72px] md:w-[72px]" />
            </div>

            <SaffronReveal>
              <div className="max-w-5xl">
                <p className="mb-6 font-mono text-[11px] tracking-[0.35em] text-white/40 uppercase">
                  Forward-deployed AI · <SaffronRotatingPhrase />
                </p>
                <h1 className="saffron-chromatic text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.98] font-semibold tracking-[-0.04em]">
                  Intelligence is no longer scarce.
                  <br />
                  <span className="text-white/50">Judgment is.</span>
                </h1>
              </div>
            </SaffronReveal>

            <div className="mt-14 grid gap-10 md:grid-cols-[1fr_320px] md:items-end">
              <SaffronReveal delayMs={100}>
                <p className="max-w-lg text-base text-white/45 md:text-lg">
                  We build at the edge — models, memory, vault, production.
                </p>
              </SaffronReveal>
              <SaffronReveal delayMs={180}>
                <SaffronPreviewSignal />
              </SaffronReveal>
            </div>
          </section>

          <SaffronDataBand />
        </main>
        <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-[11px] text-white/30">
          Design preview v2 · Futuristic (interactive horizon)
        </footer>
      </SaffronChrome>
    </div>
  );
}
