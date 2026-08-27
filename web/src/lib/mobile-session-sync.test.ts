import { describe, expect, it } from "vitest";

import {
  getMessageId,
  latestMessageId,
  mergeSessionMessages,
  parseSessionStreamEvent,
  sessionStreamCursor,
  shouldCollapseMessage,
} from "./mobile-session-sync";

const makeMessage = (id: number | undefined, role: "user" | "assistant" | "tool" = "user") => ({
  id,
  role,
  content: `${role}-${id ?? "x"}`,
});

describe("mobile-session-sync", () => {
  it("deduplicates by message id while preserving chronological order", () => {
    const merged = mergeSessionMessages(
      [makeMessage(1), makeMessage(3)],
      [makeMessage(2), makeMessage(3, "assistant"), makeMessage(undefined)],
    );

    expect(merged.map((message) => message.id)).toEqual([1, 2, 3, undefined]);
    expect(merged[2].role).toBe("assistant");
  });

  it("tracks the latest numeric message id", () => {
    expect(latestMessageId([makeMessage(1), makeMessage(8), makeMessage(undefined)])).toBe(8);
    expect(getMessageId(makeMessage(undefined))).toBeNull();
  });

  it("treats message.appended hello cursors as monotonic", () => {
    expect(
      sessionStreamCursor(
        { type: "message.appended", latest_message_id: 12, after_id: 4 },
        9,
      ),
    ).toBe(12);
    expect(sessionStreamCursor({ type: "hello", after_id: 15 }, 9)).toBe(15);
  });

  it("flags tool and artifact-style messages for collapse", () => {
    expect(shouldCollapseMessage(makeMessage(1, "tool"))).toBe(true);
    expect(
      shouldCollapseMessage({
        ...makeMessage(1, "assistant"),
        display_kind: "artifact/file",
      }),
    ).toBe(true);
    expect(shouldCollapseMessage(makeMessage(1, "assistant"))).toBe(false);
  });

  it("parses SSE event payloads safely", () => {
    expect(parseSessionStreamEvent('{"type":"message.appended","latest_message_id":7}')).toEqual(
      expect.objectContaining({ type: "message.appended", latest_message_id: 7 }),
    );
    expect(parseSessionStreamEvent("not json")).toBeNull();
  });
});
