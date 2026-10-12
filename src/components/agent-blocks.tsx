import type { UiBlock } from "@/lib/types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--primary)"];

function formatCell(value: string | number | null, format?: string) {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return value;
  if (format === "currency") return `₹${Math.round(value).toLocaleString("en-IN")}`;
  if (format === "percent") return `${value}%`;
  return value.toLocaleString("en-IN");
}

function Table({ block }: { block: Extract<UiBlock, { kind: "table" }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      {block.title && <p className="border-b border-border/70 px-3 py-2 text-sm font-medium">{block.title}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {block.columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 font-medium ${c.format && c.format !== "text" ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-t border-border/50">
              {block.columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-1.5 ${c.format && c.format !== "text" ? "text-right tabular-nums" : ""}`}
                >
                  {formatCell(row[c.key], c.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ block }: { block: Extract<UiBlock, { kind: "chart" }> }) {
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const values = block.data.flatMap((d) => block.series.map((s) => Number(d[s.key])).filter(Number.isFinite));
  const min = Math.min(0, ...values);
  const max = Math.max(...values, min + 1);
  const x = (i: number) =>
    pad.l + (block.data.length <= 1 ? 0 : (i / (block.data.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const ticks = [min, (min + max) / 2, max];
  const barGroup = (W - pad.l - pad.r) / Math.max(block.data.length, 1);
  const barWidth = (barGroup * 0.7) / block.series.length;
  const labelEvery = Math.ceil(block.data.length / 8);

  return (
    <div className="rounded-lg border border-border/70 p-3">
      {block.title && <p className="mb-2 text-sm font-medium">{block.title}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={block.title || "chart"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" opacity={0.1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.6}>
              {Math.round(t).toLocaleString("en-IN")}
            </text>
          </g>
        ))}
        {block.chartType === "bar"
          ? block.data.map((d, i) =>
              block.series.map((s, j) => {
                const v = Number(d[s.key]) || 0;
                return (
                  <rect
                    key={`${i}-${s.key}`}
                    x={pad.l + i * barGroup + barGroup * 0.15 + j * barWidth}
                    y={Math.min(y(v), y(0))}
                    width={barWidth}
                    height={Math.abs(y(0) - y(v))}
                    fill={COLORS[j % COLORS.length]}
                    rx={2}
                  />
                );
              }),
            )
          : block.series.map((s, j) => {
              const pts = block.data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`).join(" ");
              return (
                <g key={s.key}>
                  {block.chartType === "area" && (
                    <polygon
                      points={`${x(0)},${y(min)} ${pts} ${x(block.data.length - 1)},${y(min)}`}
                      fill={COLORS[j % COLORS.length]}
                      opacity={0.15}
                    />
                  )}
                  <polyline points={pts} fill="none" stroke={COLORS[j % COLORS.length]} strokeWidth={2} />
                </g>
              );
            })}
        {block.data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={i}
              x={block.chartType === "bar" ? pad.l + i * barGroup + barGroup / 2 : x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              {String(d[block.xKey])}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {block.series.map((s, j) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: COLORS[j % COLORS.length] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Card({ block }: { block: Extract<UiBlock, { kind: "card" }> }) {
  const tone =
    block.tone === "success"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : block.tone === "warning"
        ? "border-amber-500/50 bg-amber-500/5"
        : "border-border/70 bg-muted/30";
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-sm font-medium">{block.title}</p>
      {block.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{block.body}</p>}
      {block.fields && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {block.fields.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="text-sm font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Reference rendering of agent blocks; companies render these with their own components. */
export function AgentBlock({ block }: { block: UiBlock }) {
  switch (block.kind) {
    case "markdown":
      return <p className="whitespace-pre-wrap text-sm">{block.text}</p>;
    case "table":
      return <Table block={block} />;
    case "chart":
      return <Chart block={block} />;
    case "card":
      return <Card block={block} />;
  }
}
