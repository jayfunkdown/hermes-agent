import { describe, expect, it } from "vitest";

import {
  buildMobileSessionMessagesQuery,
  hasMoreEarlierMessages,
  MOBILE_CHAT_PAGE_SIZE,
  nextEarlierOffset,
} from "@/lib/mobile-chat-pagination";

describe("mobile-chat-pagination", () => {
  it("uses a bounded initial page size", () => {
    expect(MOBILE_CHAT_PAGE_SIZE).toBe(50);
    expect(buildMobileSessionMessagesQuery()).toBe("limit=50&offset=0&order=latest");
    expect(buildMobileSessionMessagesQuery({ limit: 40, offset: 80 })).toBe(
      "limit=40&offset=80&order=latest",
    );
  });

  it("detects when another earlier page may exist", () => {
    expect(hasMoreEarlierMessages(50)).toBe(true);
    expect(hasMoreEarlierMessages(49)).toBe(false);
  });

  it("advances the offset by the number of rows returned", () => {
    expect(nextEarlierOffset(0, 50)).toBe(50);
    expect(nextEarlierOffset(50, 50)).toBe(100);
  });
});
