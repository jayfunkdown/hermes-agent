import type { SessionMessage } from "@/lib/api";

const VALID_ROLES = new Set<SessionMessage["role"]>(["user", "assistant", "system", "tool"]);

export function isRenderableSessionMessage(message: unknown): message is SessionMessage {
  if (!message || typeof message !== "object") return false;
  const role = (message as SessionMessage).role;
  return VALID_ROLES.has(role);
}

/** Coerce unknown rows into a safe shape so one bad row cannot blank the feed. */
export function normalizeSessionMessage(message: SessionMessage): SessionMessage {
  const role = VALID_ROLES.has(message.role) ? message.role : "system";
  let content = message.content;
  if (content !== null && typeof content !== "string") {
    try {
      content = JSON.stringify(content);
    } catch {
      content = "";
    }
  }

  return {
    ...message,
    role,
    content: content ?? "",
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
  };
}

export function normalizeSessionMessages(messages: SessionMessage[]): SessionMessage[] {
  return messages
    .filter((message): message is SessionMessage => Boolean(message && typeof message === "object"))
    .map(normalizeSessionMessage);
}
