import Link from "next/link";

const VERSIONS = [
  {
    href: "/saffron",
    label: "Current",
    desc: "SaffronAI · Deployment palette · static horizon",
  },
  {
    href: "/saffron/preview/futuristic",
    label: "v2 — Futuristic",
    desc: "WebGL + mouse parallax · HUD · live signal · center mark",
  },
  {
    href: "/saffron/preview/deployment",
    label: "v1 — Deployment",
    desc: "Clean scroll page · CSS prism · capability pills (pre-100x)",
  },
  {
    href: "/saffron/preview/foundation",
    label: "v0 — Foundation",
    desc: "Gold vault monolith · canvas black hole · serif typography",
  },
] as const;

export default function SaffronPreviewHubPage() {
  return (
    <div className="min-h-screen bg-black px-6 py-16 font-sans text-white md:px-10">
      <h1 className="text-2xl font-semibold tracking-tight">SaffronAI design previews</h1>
      <p className="mt-2 max-w-lg text-sm text-white/45">
        Open each version in a new tab to compare. Current production target is{" "}
        <Link href="/saffron" className="text-white/70 underline underline-offset-4">
          /saffron
        </Link>
        .
      </p>
      <ul className="mt-10 space-y-3">
        {VERSIONS.map((v) => (
          <li key={v.href}>
            <Link
              href={v.href}
              className="block rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
            >
              <span className="font-medium">{v.label}</span>
              <span className="mt-1 block text-sm text-white/45">{v.desc}</span>
              <span className="mt-2 block font-mono text-[11px] text-white/30">{v.href}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
