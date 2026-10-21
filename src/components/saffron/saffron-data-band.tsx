const TOKENS =
  "PHOTON RING · VAULT PROXY · TENANT ISOLATION · FORWARD DEPLOYED · EVENT HORIZON · AGENT RUNTIME · LONG MEMORY · PRODUCTION";

export function SaffronDataBand() {
  const track = `${TOKENS} · ${TOKENS}`;

  return (
    <div className="relative z-10 overflow-hidden border-y border-white/[0.08] bg-black/30 py-3 backdrop-blur-sm">
      <div className="saffron-data-marquee flex w-max gap-12 whitespace-nowrap font-mono text-[10px] tracking-[0.4em] text-white/35 uppercase">
        <span>{track}</span>
        <span aria-hidden>{track}</span>
      </div>
    </div>
  );
}
