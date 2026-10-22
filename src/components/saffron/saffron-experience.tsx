"use client";

import "./saffron-styles.css";

import { SaffronChrome } from "@/components/saffron/saffron-chrome";
import { SaffronHorizonGl } from "@/components/saffron/saffron-horizon-gl";
import { SaffronHorizonRing } from "@/components/saffron/saffron-horizon-ring";
import { SaffronReveal } from "@/components/saffron/saffron-reveal";
const PILLARS = [
  {
    title: "Hire AI employees",
    body: "Role-specific agents with memory, tools, and guardrails, onboarded like teammates, not one-off chats.",
  },
  {
    title: "Train on your business",
    body: "Playbooks, data, and feedback loops so each agent improves inside your policies and systems.",
  },
  {
    title: "Plug-and-play infrastructure",
    body: "Multi-tenant runtime, vault secrets, APIs, and ops tooling, ready to run in production.",
  },
  {
    title: "AI-native websites",
    body: "Composable surfaces where agents, memory, and live data ship as part of the product, not bolted on.",
  },
] as const;

const CAPABILITIES = [
  "AI employees",
  "Training & playbooks",
  "Agent runtime",
  "AI-native web",
] as const;

export function SaffronExperience() {
  return (
    <div className="saffron-root relative min-h-screen overflow-x-hidden bg-black font-sans text-white antialiased selection:bg-white/20">
      <SaffronHorizonGl />
      <SaffronHorizonRing />
      <div className="pointer-events-none fixed inset-0 z-[2] bg-gradient-to-b from-transparent via-black/20 to-black/85" aria-hidden />

      <SaffronChrome>
        <main className="relative z-10">
          <section className="relative flex min-h-[100svh] flex-col justify-end px-6 pb-20 pt-28 md:px-10 md:pb-24">
            <SaffronReveal>
              <div className="max-w-4xl">
                <p className="mb-6 text-sm text-white/45 md:text-[15px]">
                  SaffronAI enables companies to{" "}
                  <span className="font-medium text-white/85">
                    hire and train
                  </span>{" "}
                  AI employees, and ship{" "}
                  <span className="font-medium text-white/85">AI-native</span> websites on plug-and-play
                  infrastructure.
                </p>
                <h1 className="text-[clamp(2.35rem,6.2vw,4.75rem)] leading-[1.01] font-semibold tracking-[-0.035em]">
                  Hire and train
                  <br />
                  <span className="text-white/55">AI employees.</span>
                </h1>
              </div>
            </SaffronReveal>

            <SaffronReveal delayMs={80}>
              <p className="mt-8 max-w-xl text-base leading-relaxed text-white/45 md:mt-10 md:text-lg">
                Plus plug-and-play infrastructure to launch AI-native websites: agents, memory, and production
                stack included.
              </p>
            </SaffronReveal>

            <div className="mt-10 flex flex-col gap-8 md:mt-12 md:flex-row md:items-end md:justify-between">
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
                <p className="text-[13px] text-white/35 md:text-right">SaffronAI · India</p>
              </SaffronReveal>
            </div>
          </section>

          <section id="story" className="border-t border-white/[0.08] bg-black/80 backdrop-blur-xl">
            <div className="mx-auto grid max-w-6xl gap-16 px-6 py-24 md:grid-cols-[1fr_1.15fr] md:px-10 md:py-32">
              <SaffronReveal>
                <p className="text-xs tracking-[0.3em] text-white/30 uppercase">What we do</p>
                <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
                  AI employees for your company. Infrastructure for AI-native products.
                </h2>
              </SaffronReveal>
              <SaffronReveal delayMs={100}>
                <p className="text-base leading-relaxed text-white/50 md:text-lg">
                  SaffronAI enables companies to hire and train AI employees, scoped to roles, connected to your
                  systems, and accountable to your standards. We also provide plug-and-play infrastructure so you
                  can ship AI-native websites and customer experiences without rebuilding the stack from scratch.
                </p>
              </SaffronReveal>
            </div>
          </section>

          <section id="work" className="border-t border-white/[0.08]">
            <div className="mx-auto max-w-6xl px-6 py-24 md:px-10">
              <SaffronReveal>
                <h2 className="text-[clamp(1.85rem,4.2vw,2.75rem)] font-semibold tracking-[-0.035em]">
                  From workforce
                  <span className="text-white/35"> to website.</span>
                </h2>
              </SaffronReveal>
              <ul className="mt-16 grid gap-px border border-white/[0.08] bg-white/[0.05] md:grid-cols-2">
                {PILLARS.map((pillar) => (
                  <li key={pillar.title} className="bg-black p-8 md:p-10">
                    <h3 className="text-sm font-medium text-white">{pillar.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-white/45">{pillar.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section id="contact" className="border-t border-white/[0.08]">
            <div className="mx-auto max-w-6xl px-6 py-24 md:px-10 md:py-32">
              <SaffronReveal>
                <h2 className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-[-0.035em]">
                  Start with one role or one site.
                </h2>
                <p className="mt-5 max-w-md text-sm text-white/45 md:text-base">
                  Tell us the AI employee you want to hire, or the AI-native experience you want live. We will
                  reply quickly.
                </p>
                <a
                  href="mailto:hello@saffronai.in"
                  className="saffron-cta mt-10 inline-flex h-12 items-center rounded-full bg-white px-8 text-sm font-medium text-black"
                >
                  hello@saffronai.in
                </a>
              </SaffronReveal>
            </div>
          </section>
        </main>

        <footer className="border-t border-white/[0.08] px-6 py-8 md:px-10">
          <div className="mx-auto max-w-6xl text-[11px] tracking-wide text-white/30">
            © {new Date().getFullYear()} SaffronAI
          </div>
        </footer>
      </SaffronChrome>
    </div>
  );
}
