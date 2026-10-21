import "../saffron-styles.css";

import { SaffronChrome } from "@/components/saffron/saffron-chrome";
import { SaffronReveal } from "@/components/saffron/saffron-reveal";
import { SaffronRotatingPhrase } from "@/components/saffron/saffron-rotating-phrase";
import { SaffronAmbientDeployment } from "@/components/saffron/saffron-ambient-deployment";

const PILLARS = [
  { title: "Real memory", body: "Context wired to systems of record — not a sandbox chat." },
  { title: "Real systems", body: "Agents in your stack with tenancy, audit, and vault secrets." },
  { title: "Real people", body: "Built with the teams who do the work, not slideware." },
  { title: "Real outcomes", body: "Measured on metrics your business already tracks." },
] as const;

const CAPABILITIES = ["Multi-tenant agents", "Vault secrets", "Slack runtime", "Control-plane API"] as const;

/** v1 — Deployment-style (after “this is better”, before 100x WebGL). */
export function SaffronLandingDeployment() {
  return (
    <div className="saffron-root relative min-h-screen overflow-x-hidden bg-black font-sans text-white antialiased selection:bg-white/20">
      <SaffronAmbientDeployment />

      <SaffronChrome>
        <main className="relative z-10">
          <section className="relative flex min-h-[100svh] flex-col justify-end px-6 pb-20 pt-28 md:px-10 md:pb-24">
            <SaffronReveal>
              <div className="max-w-4xl">
                <p className="mb-6 text-sm text-white/45 md:text-[15px]">
                  Forward-deployed AI for{" "}
                  <span className="font-medium text-white/85">
                    <SaffronRotatingPhrase />
                  </span>
                </p>
                <h1 className="text-[clamp(2.35rem,6.2vw,4.75rem)] leading-[1.01] font-semibold tracking-[-0.035em]">
                  Intelligence is no longer scarce.
                  <br />
                  <span className="text-white/55">Judgment is.</span>
                </h1>
              </div>
            </SaffronReveal>

            <div className="mt-12 flex flex-col gap-8 md:mt-14 md:flex-row md:items-end md:justify-between">
              <SaffronReveal delayMs={120}>
                <ul className="flex flex-wrap gap-2">
                  {CAPABILITIES.map((cap) => (
                    <li
                      key={cap}
                      className="rounded-full border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-[11px] tracking-wide text-white/50 backdrop-blur-sm"
                    >
                      {cap}
                    </li>
                  ))}
                </ul>
              </SaffronReveal>
              <SaffronReveal delayMs={200}>
                <p className="text-[13px] text-white/35 md:text-right">Saffron AI · India</p>
              </SaffronReveal>
            </div>
          </section>

          <section className="border-t border-white/[0.06] bg-[#020203]/85 backdrop-blur-xl">
            <div className="mx-auto grid max-w-6xl gap-16 px-6 py-24 md:grid-cols-[1fr_1.15fr] md:px-10 md:py-32">
              <SaffronReveal>
                <p className="text-xs tracking-[0.3em] text-white/30 uppercase">Approach</p>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
                  Probabilistic models, meet deterministic judgment.
                </h2>
              </SaffronReveal>
              <SaffronReveal delayMs={100}>
                <p className="text-base leading-relaxed text-white/50 md:text-lg">
                  Everyone has the models. We make intelligence land — inside real data, real systems, and teams
                  who adopt it.
                </p>
              </SaffronReveal>
            </div>
          </section>

          <section className="border-t border-white/[0.06]">
            <div className="mx-auto max-w-6xl px-6 py-24 md:px-10">
              <SaffronReveal>
                <h2 className="text-[clamp(1.85rem,4.2vw,2.75rem)] font-semibold tracking-[-0.035em]">
                  We do AI pilots
                  <span className="text-white/35"> deployments.</span>
                </h2>
              </SaffronReveal>
              <ul className="mt-16 grid gap-px border border-white/[0.08] bg-white/[0.05] md:grid-cols-2">
                {PILLARS.map((pillar) => (
                  <li key={pillar.title} className="bg-[#020203] p-8 md:p-10">
                    <h3 className="text-sm font-medium text-white">{pillar.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-white/45">{pillar.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </main>
        <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-[11px] text-white/30">
          Design preview v1 · Deployment-style
        </footer>
      </SaffronChrome>
    </div>
  );
}
