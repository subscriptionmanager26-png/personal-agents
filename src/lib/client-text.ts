import type { TraceEvent } from "@/lib/trace-types";
import type { ActionRequired, StreamEvent, StreamEventInput, UiBlock } from "@/lib/types";

/**
 * Everything an end user sees passes through here: clients never learn which agent platform
 * runs their assistant, and see agent files as one flat Files list rather than VM paths.
 */

const FILE_LINK = /\[([^\]]+)\]\((?:\/opt\/cursor\/|\.?\/?artifacts\/)[^)\s]*\)/g;
const FILE_PATH = /(?:\/opt\/cursor\/(?:artifacts\/)?|(?<![\w/.-])\.?\/?artifacts\/)(?:[\w.-]+\/)*([\w.-]+)/g;

const FILES_DIR = String.raw`(?:\`\.?\/?artifacts\/?\`|\.?\/?artifacts\/(?![\w\/-]|\.\w)|artifacts folder\b)`;

const REWRITES: [RegExp, string][] = [
  [new RegExp(String.raw`\b(?:under|in|inside)\s+(?:the\s+)?${FILES_DIR}`, "gi"), "in your Files"],
  [new RegExp(String.raw`\b(?:to|into)\s+(?:the\s+)?${FILES_DIR}`, "gi"), "to your Files"],
  [new RegExp(String.raw`(?<![\w\/.-])(?:the\s+)?${FILES_DIR}`, "gi"), "your Files"],
  [/https?:\/\/(?:[\w-]+\.)*cursor\.(?:com|sh)\S*/gi, ""],
  [/\bCursor API key\b/g, "API key"],
  [/\bbc-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, ""],
  [/\bcursor\/[\w.-]+/g, ""],
  [/\b(?:the\s+)?Cursor(?:'s)?\s+(?:cloud\s+|background\s+)?agents?\b/gi, "the assistant"],
  [/\b(?:the\s+)?Cursor\s+(?:cloud|platform|API|backend|VM)\b/gi, "the assistant"],
  [/\bCursor's\b/g, "the assistant's"],
  [/\bCursor\b/g, "the assistant"],
  [/\b(a|an|the)\s+the assistant/gi, "$1 assistant"],
  [/\ba assistant\b/g, "an assistant"],
  [/(^|[.!?]\s+)the assistant/g, "$1The assistant"],
  [/(\S) {2,}(?=\S)/g, "$1 "],
  [/ +([.,;:!?])/g, "$1"],
  [/ +$/, ""],
];

export function clientText(text: string | undefined | null) {
  if (!text) return "";
  let out = text.replace(FILE_LINK, "**$1**").replace(FILE_PATH, "$1");
  for (const [pattern, replacement] of REWRITES) out = out.replace(pattern, replacement);
  return out;
}

const INTERNAL_ERROR = /cursor|github|\brepo\b|http\s*\d{3}|\bbc-|api key|token|fetch failed|econn|status [A-Z_]+$/i;

export function clientError(message: string | undefined) {
  if (!message) return "Your assistant could not finish this message. Please try again.";
  return INTERNAL_ERROR.test(message)
    ? "Your assistant could not finish this message. Please try again."
    : clientText(message);
}

export function clientBlock(block: UiBlock): UiBlock {
  switch (block.kind) {
    case "markdown":
      return { ...block, text: clientText(block.text) };
    case "card":
      return {
        ...block,
        title: clientText(block.title),
        body: block.body && clientText(block.body),
        fields: block.fields?.map((f) => ({ label: clientText(f.label), value: clientText(f.value) })),
      };
    case "table":
      return {
        ...block,
        title: block.title && clientText(block.title),
        columns: block.columns.map((c) => ({ ...c, label: clientText(c.label) })),
        rows: block.rows.map((r) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? clientText(v) : v])),
        ),
      };
    case "chart":
      return {
        ...block,
        title: block.title && clientText(block.title),
        series: block.series.map((s) => ({ ...s, label: clientText(s.label) })),
      };
  }
}

export function clientAction(action: ActionRequired): ActionRequired {
  return action.kind === "connection_login"
    ? { ...action, message: action.message && clientText(action.message) }
    : { ...action, rationale: clientText(action.rationale) };
}

export function clientStreamEvent<T extends StreamEvent | StreamEventInput>(event: T): T {
  switch (event.type) {
    case "status":
      return { ...event, label: clientText(event.label) };
    case "block":
      return { ...event, block: clientBlock(event.block) };
    case "action_required":
      return { ...event, action: clientAction(event.action) };
    case "error":
      return { ...event, message: clientError(event.message) };
    default:
      return event;
  }
}

/** The browser only needs the kind of step for its progress label, never the agent's raw trace. */
export function clientTrace(event: TraceEvent): TraceEvent {
  switch (event.type) {
    case "thinking":
    case "assistant":
      return { type: event.type, text: "" };
    case "tool":
      return {
        type: "tool",
        callId: "",
        name: "",
        title: "",
        kind: event.kind,
        status: event.status,
        ...(event.file ? { file: { path: "", action: event.file.action } } : {}),
      };
    case "result":
      return { type: "result", status: event.status };
    case "error":
      return { type: "error", message: clientError(event.message) };
    default:
      return event;
  }
}
