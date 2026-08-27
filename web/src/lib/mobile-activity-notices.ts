/** Desktop-parity transient activity labels for mobile Bot Mode. */

import type { SessionMessage } from "@/lib/api";

const TOOL_TITLES: Record<string, { pending: string; done: string }> = {
  memory: { pending: "Saving to memory", done: "Saved to memory" },
  terminal: { pending: "Running command", done: "Ran command" },
  execute_code: { pending: "Scripting", done: "Ran code" },
  read_file: { pending: "Reading file", done: "Read file" },
  write_file: { pending: "Writing file", done: "Wrote file" },
  edit_file: { pending: "Editing file", done: "Edited file" },
  patch: { pending: "Patching file", done: "Patched file" },
  list_files: { pending: "Listing files", done: "Listed files" },
  search_files: { pending: "Searching files", done: "Searched files" },
  web_search: { pending: "Searching the web", done: "Searched the web" },
  web_extract: { pending: "Fetching webpage", done: "Fetched webpage" },
  image_generate: { pending: "Generating image", done: "Generated image" },
  vision_analyze: { pending: "Analyzing image", done: "Analyzed image" },
  session_search_recall: { pending: "Searching session history", done: "Searched session history" },
  delegate_task: { pending: "Delegating", done: "Delegated" },
  clarify: { pending: "Asking a question", done: "Asked a question" },
  cronjob: { pending: "Scheduling cron job", done: "Cron job" },
  todo: { pending: "Updating todos", done: "Updated todos" },
};

const EXPLORE_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
  "session_search_recall",
  "vision_analyze",
  "web_extract",
  "web_search",
]);

function humanizeToolName(name: string): string {
  return name
    .replace(/^browser_/, "")
    .replace(/^web_/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toolPendingLabel(toolName: string): string {
  const key = toolName.trim().toLowerCase();
  const titled = TOOL_TITLES[key];
  if (titled) return titled.pending;
  if (key.startsWith("browser_")) return `Running browser ${humanizeToolName(key).toLowerCase()}`;
  if (EXPLORE_TOOLS.has(key)) return `Exploring`;
  if (key === "terminal" || key === "execute_code") return "Running";
  return `Running ${humanizeToolName(key).toLowerCase()}`;
}

export function toolDoneLabel(toolName: string): string {
  const key = toolName.trim().toLowerCase();
  const titled = TOOL_TITLES[key];
  if (titled) return titled.done;
  if (key.startsWith("browser_")) return humanizeToolName(key);
  if (EXPLORE_TOOLS.has(key)) return `Explored`;
  if (key === "terminal" || key === "execute_code") return "Ran command";
  return humanizeToolName(key);
}

function statusTextFromPayload(payload: unknown): string | null {
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) return null;
  return text.replace(/^[^\p{L}\p{N}]+/u, "").trim() || text;
}

export function activityLabelForGatewayEvent(type: string, payload: unknown): string | null {
  const data =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  switch (type) {
    case "thinking.delta":
      return "Thinking…";
    case "tool.generating": {
      if (typeof data.name === "string" && data.name.trim().toLowerCase() === "reply") {
        return "Drafting reply…";
      }
      return typeof data.name === "string" ? toolPendingLabel(data.name) : "Generating…";
    }
    case "tool.start":
      return typeof data.name === "string" ? toolPendingLabel(data.name) : "Running tool";
    case "tool.progress":
      return typeof data.message === "string"
        ? data.message
        : typeof data.preview === "string"
          ? data.preview
          : "Tool in progress";
    case "tool.complete":
      return typeof data.name === "string" ? toolDoneLabel(data.name) : "Tool finished";
    case "status.update": {
      if (data.kind === "compacting") return "Summarizing thread";
      const text = statusTextFromPayload(payload);
      return text;
    }
    case "message.interim":
      return typeof data.text === "string" ? data.text : "Drafting reply…";
    case "review.summary": {
      const text = statusTextFromPayload(payload);
      if (!text) return null;
      return text.startsWith("Self-improvement") ? text : `Self-improvement review: ${text}`;
    }
    default:
      return null;
  }
}

const REVIEW_NOTE_RE = /^review:(?<label>[^:\n]+):?\s*(?<detail>[\s\S]*)$/;
const STEER_NOTE_RE = /^steer:(?<text>[\s\S]+)$/;
const SLASH_STATUS_RE = /^slash:(?<command>\/[^\n]+)\n(?<output>[\s\S]*)$/;

export function systemNoticeLabel(content: string | null | undefined): string | null {
  const text = (content || "").trim();
  if (!text) return null;

  const review = text.match(REVIEW_NOTE_RE);
  if (review?.groups) {
    const detail = review.groups.detail?.trim();
    const label = review.groups.label.trim();
    return detail ? `${label}: ${detail}` : label;
  }

  const steer = text.match(STEER_NOTE_RE);
  if (steer?.groups?.text) {
    return `Steered · ${steer.groups.text.trim()}`;
  }

  const slash = text.match(SLASH_STATUS_RE);
  if (slash?.groups) {
    const output = slash.groups.output.trim();
    return output ? `${slash.groups.command} · ${output.split("\n")[0]}` : slash.groups.command;
  }

  return text;
}

export function toolNoticeLabel(
  message: SessionMessage,
  options: { pending?: boolean; error?: boolean } = {},
): string | null {
  const name = (message.tool_name || "").trim();
  if (!name) return null;
  const pending = options.pending ?? message.active === true;
  const failed =
    options.error ??
    (typeof message.content === "string" && /\berror\b/i.test(message.content));
  if (failed) return `${toolDoneLabel(name)} failed`;
  return pending ? toolPendingLabel(name) : toolDoneLabel(name);
}

const PENDING_ACTIVITY_TYPES = new Set([
  "thinking.delta",
  "tool.generating",
  "tool.start",
  "tool.progress",
  "message.interim",
  "status.update",
]);

export function isPendingActivityType(type: string): boolean {
  return PENDING_ACTIVITY_TYPES.has(type);
}
