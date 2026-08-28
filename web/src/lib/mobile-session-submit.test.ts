import { describe, expect, it } from "vitest";

import type { SessionMessage, SessionMessagesResponse } from "@/lib/api";

import {
  createOptimisticUserMessage,
  hasVisibleUserMessage,
  mergeMessageDeltaPage,
  reconcileSubmittedUserMessage,
  resolveSubmitTargetSessionId,
} from "./mobile-session-submit";
import { mergeSessionMessages } from "./mobile-session-sync";

const user = (id: number, content: string): SessionMessage => ({
  id,
  role: "user",
  content,
});

describe("mobile-session-submit", () => {
  it("resolves the submit target from the server session id first", () => {
    expect(resolveSubmitTargetSessionId("runtime-tip", "cec445da", "cec445da")).toBe("runtime-tip");
    expect(resolveSubmitTargetSessionId(undefined, "resolved", "cec445da")).toBe("resolved");
  });

  it("replaces the optimistic bubble with the persisted server row", () => {
    const optimistic = createOptimisticUserMessage("phone ab289 live test");
    const persisted = user(42, "phone ab289 live test");
    const merged = reconcileSubmittedUserMessage(
      mergeSessionMessages([user(4, "desktop")], [optimistic]),
      "phone ab289 live test",
      persisted,
    );

    expect(merged.map((message) => message.id)).toEqual([4, 42]);
    expect(hasVisibleUserMessage(merged, "phone ab289 live test")).toBe(true);
  });

  it("keeps the optimistic bubble until the persisted row arrives", () => {
    const optimistic = createOptimisticUserMessage("mobile submit check 0815");
    const merged = reconcileSubmittedUserMessage(
      mergeSessionMessages([], [optimistic]),
      "mobile submit check 0815",
      null,
    );

    expect(hasVisibleUserMessage(merged, "mobile submit check 0815")).toBe(true);
  });

  it("does not treat unchanged delta pages as new transcript rows", () => {
    const existing = [user(4, "desktop")];
    const page: SessionMessagesResponse = {
      session_id: "cec445da",
      messages: [],
      revision: 4,
      latest_message_id: 4,
      unchanged: true,
    };

    const result = mergeMessageDeltaPage(existing, page, 4);

    expect(result.changed).toBe(false);
    expect(result.messages).toBe(existing);
    expect(result.cursor).toBe(4);
  });

  it("merges forced delta rows after submit", () => {
    const existing = [user(4, "desktop")];
    const page: SessionMessagesResponse = {
      session_id: "cec445da",
      messages: [user(5, "phone ab289 live test")],
      revision: 5,
      latest_message_id: 5,
    };

    const result = mergeMessageDeltaPage(existing, page, 4);

    expect(result.changed).toBe(true);
    expect(result.messages.map((message) => message.content)).toEqual([
      "desktop",
      "phone ab289 live test",
    ]);
    expect(result.cursor).toBe(5);
  });
});
