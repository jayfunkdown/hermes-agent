import { describe, expect, it } from "vitest";

import {
  MOBILE_CHAT_EMPTY_TEXT,
  MOBILE_CHAT_LOAD_TIMEOUT_MS,
  MOBILE_CHAT_LOAD_TIMEOUT_TEXT,
  shouldShowChatEmptyState,
  shouldShowChatLoadFailure,
  shouldShowChatLoadingSpinner,
} from "@/lib/mobile-mirror-chat-state";

describe("mobile-mirror-chat-state", () => {
  it("shows a spinner only while the first page is loading", () => {
    expect(
      shouldShowChatLoadingSpinner({
        messagesLoading: true,
        messageCount: 0,
        chatLoadFailed: false,
      }),
    ).toBe(true);
    expect(
      shouldShowChatLoadingSpinner({
        messagesLoading: false,
        messageCount: 0,
        chatLoadFailed: false,
      }),
    ).toBe(false);
    expect(
      shouldShowChatLoadingSpinner({
        messagesLoading: true,
        messageCount: 2,
        chatLoadFailed: false,
      }),
    ).toBe(false);
  });

  it("shows the empty-state copy once loading finishes with no messages", () => {
    expect(
      shouldShowChatEmptyState({
        messagesLoading: false,
        chatLoadFailed: false,
        messageCount: 0,
      }),
    ).toBe(true);
    expect(MOBILE_CHAT_EMPTY_TEXT).toContain("No messages yet");
  });

  it("shows retry affordance after a failed or timed-out load", () => {
    expect(
      shouldShowChatLoadFailure({
        chatLoadFailed: true,
        messageCount: 0,
      }),
    ).toBe(true);
    expect(MOBILE_CHAT_LOAD_TIMEOUT_MS).toBe(12_000);
    expect(MOBILE_CHAT_LOAD_TIMEOUT_TEXT).toBe("Couldn't load this chat.");
  });
});
