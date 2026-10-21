const ITEMS = [
  "Event horizon",
  "Photon ring",
  "Sacred geometry",
  "Prime radiant",
  "Gravitational lens",
  "Deep memory",
  "Forward deployed",
];

export function SaffronMarquee() {
  const track = [...ITEMS, ...ITEMS].join(" · ");

  return (
    <div className="relative z-10 overflow-hidden border-y border-white/[0.06] bg-black/20 py-3 backdrop-blur-sm">
      <div className="saffron-marquee flex w-max gap-8 whitespace-nowrap font-sans text-[11px] tracking-[0.35em] text-[#6a7588] uppercase">
        <span>{track}</span>
        <span aria-hidden>{track}</span>
      </div>
    </div>
  );
}
