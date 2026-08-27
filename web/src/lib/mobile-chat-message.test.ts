import { describe, expect, it } from "vitest";

import {
  isRenderableSessionMessage,
  normalizeSessionMessage,
  normalizeSessionMessages,
} from "@/lib/mobile-chat-message";
import type { SessionMessage } from "@/lib/api";

describe("mobile-chat-message", () => {
  it("accepts standard session rows", () => {
    const message: SessionMessage = { id: 1, role: "user", content: "hello" };
    expect(isRenderableSessionMessage(message)).toBe(true);
    expect(normalizeSessionMessage(message).content).toBe("hello");
  });

  it("coerces malformed rows into safe placeholders", () => {
    const normalized = normalizeSessionMessage({
      id: 2,
      role: "unknown" as SessionMessage["role"],
      content: { blob: true } as unknown as string,
    });
    expect(normalized.role).toBe("system");
    expect(normalized.content).toContain("blob");
  });

  it("drops completely invalid rows during batch normalization", () => {
    const rows = normalizeSessionMessages([
      { id: 1, role: "assistant", content: "ok" },
      null as unknown as SessionMessage,
      { id: 2, role: "nope" as SessionMessage["role"], content: "bad" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.role).toBe("system");
  });
});
