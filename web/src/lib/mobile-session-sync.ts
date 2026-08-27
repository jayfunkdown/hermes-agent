import type { SessionInfo, SessionMessage } from "@/lib/api";

export interface SessionStreamEvent {
  type: string;
  session_id?: string;
  revision?: number;
  latest_message_id?: number;
  after_id?: number;
  message_ids?: number[];
  degraded?: boolean;
}

export function getMessageId(message: SessionMessage): number | null {
  return typeof message.id === "number" && Number.isFinite(message.id)
    ? message.id
    : null;
}

export function latestMessageId(messages: SessionMessage[]): number {
  let latest = 0;
  for (const message of messages) {
    const id = getMessageId(message);
    if (id !== null && id > latest) {
      latest = id;
    }
  }
  return latest;
}

export function mergeSessionMessages(
  existing: SessionMessage[],
  incoming: SessionMessage[],
): SessionMessage[] {
  const byId = new Map<number, SessionMessage>();
  const withoutId: SessionMessage[] = [];

  for (const message of [...existing, ...incoming]) {
    const id = getMessageId(message);
    if (id === null) {
      withoutId.push(message);
      continue;
    }
    byId.set(id, message);
  }

  return [
    ...Array.from(byId.entries())
      .sort(([left], [right]) => left - right)
      .map(([, message]) => message),
    ...withoutId,
  ];
}

export function sessionTitle(session: SessionInfo | null | undefined): string {
  if (!session) return "";
  const title = session.title?.trim();
  if (title && title !== "Untitled") return title;
  const preview = session.preview?.trim();
  if (preview) return preview;
  return session.id;
}

export function sessionDisplayLabel(session: SessionInfo | null | undefined): string {
  const label = sessionTitle(session);
  return label || "Session";
}

export function sessionListTitle(session: SessionInfo | null | undefined): string {
  if (!session) return "Session";
  const title = session.title?.trim();
  if (title && title !== "Untitled") return title;
  return session.id;
}

export function sessionPreviewText(session: SessionInfo | null | undefined): string {
  if (!session) return "No messages yet";
  const preview = session.preview?.trim();
  if (preview) return preview;
  if (session.message_count > 0) return `${session.message_count} messages`;
  return "No messages yet";
}

export function sessionInitials(session: SessionInfo | null | undefined): string {
  const label = sessionListTitle(session);
  const parts = label.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || "AG";
}

export const HUB_SESSION_POLL_MS = 30_000;
export const HUB_PREVIEW_MAX_LEN = 120;

export function previewFromMessages(messages: SessionMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.display_kind === "hidden") continue;
    const text = message.content?.trim();
    if (!text) continue;
    if (text.length <= HUB_PREVIEW_MAX_LEN) return text;
    return `${text.slice(0, HUB_PREVIEW_MAX_LEN).trim()}…`;
  }
  return "";
}

export function countPersistedMessages(messages: SessionMessage[]): number {
  return messages.reduce(
    (count, message) => (getMessageId(message) === null ? count : count + 1),
    0,
  );
}

export function bumpSessionInList(
  sessions: SessionInfo[],
  sessionId: string,
  messages?: SessionMessage[],
): SessionInfo[] {
  const now = Math.floor(Date.now() / 1000);
  const preview = messages ? previewFromMessages(messages) : "";
  const messageCount = messages ? countPersistedMessages(messages) : 0;
  let touched = false;
  const next = sessions.map((session) => {
    if (session.id !== sessionId) return session;
    touched = true;
    return {
      ...session,
      last_active: now,
      is_active: true,
      ...(preview ? { preview } : {}),
      ...(messageCount > 0
        ? { message_count: Math.max(session.message_count, messageCount) }
        : {}),
    };
  });
  if (!touched) return sessions;
  return [...next].sort((left, right) => right.last_active - left.last_active);
}

export function lastVisibleMessageRole(
  messages: SessionMessage[],
): SessionMessage["role"] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.display_kind === "hidden") continue;
    return message.role;
  }
  return null;
}

export function shouldShowThinkingIndicator(
  messages: SessionMessage[],
  awaitingReply: boolean,
  streamLive: boolean,
): boolean {
  if (!streamLive && !awaitingReply) return false;
  if (awaitingReply) return true;
  return lastVisibleMessageRole(messages) === "user";
}

export function shouldCollapseMessage(message: SessionMessage): boolean {
  if (message.role === "tool") return true;
  if (message.tool_calls && message.tool_calls.length > 0) return true;
  const kind = String(message.display_kind ?? "").toLowerCase();
  return /artifact|file|attachment|media|binary/.test(kind);
}

export function sessionStreamCursor(
  event: SessionStreamEvent,
  currentCursor: number,
): number {
  const candidate =
    event.latest_message_id ?? event.revision ?? event.after_id ?? currentCursor;
  return Math.max(currentCursor, candidate ?? currentCursor);
}

export function parseSessionStreamEvent(raw: string): SessionStreamEvent | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as SessionStreamEvent;
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
