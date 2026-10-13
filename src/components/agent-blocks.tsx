import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { Chart } from "@/components/chat/chart";
import { Markdown } from "@/components/chat/markdown";
import type { UiBlock } from "@/lib/types";

function formatCell(value: string | number | null, format?: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number") return value;
  if (format === "currency") return `₹${Math.round(value).toLocaleString("en-IN")}`;
  if (format === "percent") return `${value}%`;
  return value.toLocaleString("en-IN");
}

function Table({ block }: { block: Extract<UiBlock, { kind: "table" }> }) {
  const numeric = (format?: string) => Boolean(format && format !== "text");
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {block.title && (
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-medium">{block.title}</p>
          <span className="text-xs text-muted-foreground">{block.rows.length} rows</span>
        </div>
      )}
      <div className="scrollbar-thin max-h-[420px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="text-xs text-muted-foreground">
              {block.columns.map((c) => (
                <th
                  key={c.key}
                  className={`border-b px-4 py-2 font-medium whitespace-nowrap ${numeric(c.format) ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-muted/40 [&:not(:last-child)>td]:border-b [&>td]:border-border/60">
                {block.columns.map((c, ci) => {
                  const v = row[c.key];
                  const negative = typeof v === "number" && v < 0 && (c.format === "currency" || c.format === "percent");
                  return (
                    <td
                      key={c.key}
                      className={`px-4 py-2 whitespace-nowrap ${numeric(c.format) ? "text-right tabular-nums" : ""} ${
                        ci === 0 ? "font-medium" : ""
                      } ${negative ? "text-destructive" : ""}`}
                    >
                      {formatCell(v, c.format)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TONES = {
  info: { icon: Info, className: "text-info bg-info/10" },
  success: { icon: CheckCircle2, className: "text-success bg-success/10" },
  warning: { icon: AlertTriangle, className: "text-warning bg-warning/10" },
} as const;

function Card({ block }: { block: Extract<UiBlock, { kind: "card" }> }) {
  const tone = TONES[block.tone ?? "info"];
  const Icon = tone.icon;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start gap-3 p-4">
        <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${tone.className}`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-medium leading-7">{block.title}</p>
          {block.body && <p className="mt-0.5 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">{block.body}</p>}
        </div>
      </div>
      {block.fields && block.fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t bg-muted/20 px-4 py-3 sm:grid-cols-3">
          {block.fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums">{f.value}</dd>
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
      return <Markdown text={block.text} />;
    case "table":
      return <Table block={block} />;
    case "chart":
      return <Chart block={block} />;
    case "card":
      return <Card block={block} />;
  }
}
