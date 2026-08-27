import { describe, expect, it } from "vitest";

import {
  getMessageId,
  latestMessageId,
  mergeSessionMessages,
  parseSessionStreamEvent,
  sessionInitials,
  sessionListTitle,
  sessionPreviewText,
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

  it("builds hub list labels and preview text", () => {
    expect(
      sessionListTitle({
        id: "20250827_120000_abcd",
        title: "Boss bot",
      } as never),
    ).toBe("Boss bot");
    expect(
      sessionPreviewText({
        id: "s1",
        preview: "  latest reply  ",
        message_count: 4,
      } as never),
    ).toBe("latest reply");
    expect(sessionInitials({ id: "s1", title: "Boss Bot" } as never)).toBe("BB");
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

  it("does not advance cursor before delta fetch would use the prior watermark", () => {
    const priorCursor = 5;
    const eventWatermark = sessionStreamCursor(
      { type: "message.appended", latest_message_id: 12 },
      priorCursor,
    );
    expect(eventWatermark).toBe(12);
    // Delta fetch must use priorCursor (5), not eventWatermark (12), as after_id.
    const delta = mergeSessionMessages(
      [makeMessage(5, "assistant")],
      [makeMessage(6), makeMessage(7)],
    );
    expect(latestMessageId(delta)).toBe(7);
  });
});
