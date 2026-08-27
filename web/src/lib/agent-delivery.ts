/** Agent-to-agent delivery detection (desktop parity: user-message + agent-delivery). */

export const AGENT_MESSAGE_RE =
  /^(?:Message from (?:🤖\s*)?([^:\n(]{1,64}?)(?:\s*\(@([a-z0-9][a-z0-9_-]{0,63})\))?:\s*|\[Message from agent '([^']{1,64})'\]\s*)([\s\S]*)$/u;

const DELIVERY_COMMAND_RE =
  /(?:^|[;&|]\s*|\bhermes\s+)-p\s+("?)([a-z0-9][a-z0-9_-]{0,63})\1\s+chat\b[\s\S]*?-q\s+["']Message from/iu;

export interface ParsedAgentMessage {
  sender: string;
  handle: string;
  body: string;
}

export function parseAgentMessage(text: string): ParsedAgentMessage | null {
  const match = AGENT_MESSAGE_RE.exec(text.trim());
  if (!match) return null;
  const sender = (match[1] || match[3] || "agent").trim();
  const handle = (match[2] || match[3] || sender).trim();
  return {
    sender,
    handle: handle.toLowerCase(),
    body: (match[4] || "").trim(),
  };
}

export function isAgentDeliveryMessage(text: string): boolean {
  return AGENT_MESSAGE_RE.test(text.trim());
}

export function deliveryTargetFromCommand(command: string): string | null {
  const match = DELIVERY_COMMAND_RE.exec(command);
  return match ? match[2].toLowerCase() : null;
}

export function replyTextFromResult(result: unknown): string {
  const container = (result ?? {}) as { content?: unknown; output?: unknown };
  let raw = "";

  if (typeof result === "string") {
    raw = result;
  } else if (typeof container.output === "string") {
    raw = container.output;
  } else if (Array.isArray(container.content)) {
    raw = container.content
      .map((entry) =>
        typeof (entry as { text?: unknown })?.text === "string" ? (entry as { text: string }).text : "",
      )
      .join("\n");
  }

  if (raw.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { output?: unknown };
      if (typeof parsed.output === "string") {
        raw = parsed.output;
      }
    } catch {
      /* not JSON */
    }
  }

  return raw
    .split("\n")
    .filter((line) => !/^session_id:\s/.test(line.trim()))
    .join("\n")
    .trim();
}

export function parseTerminalToolArgs(raw: string | undefined): { command?: string } {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as { command?: unknown };
    return typeof parsed.command === "string" ? { command: parsed.command } : {};
  } catch {
    return {};
  }
}
