"use client";

import { useRef, useState } from "react";

import type { UiBlock } from "@/lib/types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--foreground)"];
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function Chart({ block }: { block: Extract<UiBlock, { kind: "chart" }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = 240;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const n = block.data.length;
  const values = block.data.flatMap((d) => block.series.map((s) => Number(d[s.key])).filter(Number.isFinite));
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(...values, rawMin + 1);
  const span = rawMax - rawMin;
  const min = rawMin < 0 ? rawMin - span * 0.05 : rawMin;
  const max = rawMax + span * 0.05;
  const isBar = block.chartType === "bar";
  const band = (W - pad.l - pad.r) / Math.max(n, 1);
  const x = (i: number) => (isBar ? pad.l + i * band + band / 2 : pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r)));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  const barWidth = Math.min(36, (band * 0.7) / block.series.length);
  const labelEvery = Math.ceil(n / (isBar ? 10 : 6));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !n) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = isBar ? Math.floor((px - pad.l) / band) : Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  const hovered = hover === null ? undefined : block.data[hover];
  const tipLeft = hover === null ? 0 : (x(hover) / W) * 100;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {block.title && <p className="text-sm font-medium">{block.title}</p>}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {block.series.map((s, j) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ background: COLORS[j % COLORS.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full overflow-visible"
          role="img"
          aria-label={block.title || "chart"}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {block.series.map((s, j) => (
              <linearGradient key={s.key} id={`fill-${s.key}-${j}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={COLORS[j % COLORS.length]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={COLORS[j % COLORS.length]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 4" />
              <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.5}>
                {compact.format(t)}
              </text>
            </g>
          ))}
          {isBar
            ? block.data.map((d, i) =>
                block.series.map((s, j) => {
                  const v = Number(d[s.key]) || 0;
                  const left = x(i) - (barWidth * block.series.length) / 2 + j * barWidth;
                  return (
                    <rect
                      key={`${i}-${s.key}`}
                      x={left + 1}
                      y={Math.min(y(v), y(0))}
                      width={Math.max(barWidth - 2, 1)}
                      height={Math.max(Math.abs(y(0) - y(v)), 1)}
                      fill={COLORS[j % COLORS.length]}
                      fillOpacity={hover === null || hover === i ? 0.9 : 0.4}
                      rx={3}
                    />
                  );
                }),
              )
            : block.series.map((s, j) => {
                const pts = block.data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`);
                return (
                  <g key={s.key}>
                    <polygon points={`${x(0)},${y(Math.max(min, 0))} ${pts.join(" ")} ${x(n - 1)},${y(Math.max(min, 0))}`} fill={`url(#fill-${s.key}-${j})`} opacity={block.chartType === "area" ? 1 : 0.6} />
                    <polyline points={pts.join(" ")} fill="none" stroke={COLORS[j % COLORS.length]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}
          {hover !== null && !isBar && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="currentColor" strokeOpacity={0.2} />
              {block.series.map((s, j) => (
                <circle key={s.key} cx={x(hover)} cy={y(Number(block.data[hover][s.key]) || 0)} r={3.5} fill="var(--card)" stroke={COLORS[j % COLORS.length]} strokeWidth={2} />
              ))}
            </g>
          )}
          {block.data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.5}>
                {String(d[block.xKey]).slice(0, 12)}
              </text>
            ) : null,
          )}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-32 -translate-x-1/2 rounded-lg border bg-popover px-2.5 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min(Math.max(tipLeft, 12), 88)}%` }}
          >
            <p className="mb-1 font-medium">{String(hovered[block.xKey])}</p>
            {block.series.map((s, j) => (
              <p key={s.key} className="flex items-center justify-between gap-3 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: COLORS[j % COLORS.length] }} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums text-foreground">{full.format(Number(hovered[s.key]) || 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
