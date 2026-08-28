import type { SessionMessage, SessionMessagesResponse } from "@/lib/api";

import {
  getMessageId,
  latestMessageId,
  mergeSessionMessages,
} from "./mobile-session-sync";

export const OPTIMISTIC_USER_MESSAGE_ID = -1;

export interface ApplyMessageDeltaOptions {
  /** Skip if_revision so a post-submit catch-up cannot be short-circuited. */
  force?: boolean;
}

export function messageContentText(message: SessionMessage | null | undefined): string {
  if (!message) return "";
  return String(message.content ?? "").trim();
}

export function createOptimisticUserMessage(text: string): SessionMessage {
  const trimmed = text.trim();
  return {
    id: OPTIMISTIC_USER_MESSAGE_ID,
    role: "user",
    content: trimmed,
    timestamp: Date.now() / 1000,
  };
}

export function isOptimisticUserMessage(
  message: SessionMessage,
  submittedText?: string,
): boolean {
  const id = getMessageId(message);
  if (id === null || id >= 0) return false;
  if (message.role !== "user") return false;
  if (submittedText === undefined) return true;
  return messageContentText(message) === submittedText.trim();
}

export function hasVisibleUserMessage(
  messages: readonly SessionMessage[],
  submittedText: string,
): boolean {
  const expected = submittedText.trim();
  if (!expected) return false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.display_kind === "hidden" || message.role !== "user") {
      continue;
    }
    if (messageContentText(message) === expected) {
      return true;
    }
  }

  return false;
}

export function reconcileSubmittedUserMessage(
  messages: SessionMessage[],
  submittedText: string,
  persisted?: SessionMessage | null,
): SessionMessage[] {
  if (!persisted) {
    return messages;
  }

  const trimmed = submittedText.trim();
  const withoutOptimistic = messages.filter(
    (message) => !isOptimisticUserMessage(message, trimmed),
  );

  return mergeSessionMessages(withoutOptimistic, [persisted]);
}

export function mergeMessageDeltaPage(
  existing: SessionMessage[],
  page: SessionMessagesResponse,
  cursor: number,
): { messages: SessionMessage[]; cursor: number; changed: boolean } {
  if (page.unchanged || !page.messages?.length) {
    const revision = page.latest_message_id ?? page.revision ?? cursor;
    return {
      messages: existing,
      cursor: Math.max(cursor, revision),
      changed: false,
    };
  }

  const merged = mergeSessionMessages(existing, page.messages);
  return {
    messages: merged,
    cursor: latestMessageId(merged),
    changed: true,
  };
}

export function resolveSubmitTargetSessionId(
  resultSessionId: string | undefined,
  resolvedSessionId: string,
  selectedSessionId: string,
): string {
  return resultSessionId || resolvedSessionId || selectedSessionId;
}
