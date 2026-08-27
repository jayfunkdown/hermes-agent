import { describe, expect, it } from "vitest";

import type { SessionMessage } from "@/lib/api";
import {
  activityLabelForGatewayEvent,
  systemNoticeLabel,
  toolNoticeLabel,
} from "@/lib/mobile-activity-notices";

describe("mobile-activity-notices", () => {
  it("maps status.update text field (not message)", () => {
    expect(activityLabelForGatewayEvent("status.update", { text: "writing to memory" })).toBe(
      "writing to memory",
    );
    expect(activityLabelForGatewayEvent("status.update", { message: "ignored" })).toBeNull();
  });

  it("maps tool lifecycle events to desktop copy", () => {
    expect(activityLabelForGatewayEvent("tool.start", { name: "memory" })).toBe("Saving to memory");
    expect(activityLabelForGatewayEvent("tool.complete", { name: "memory" })).toBe("Saved to memory");
    expect(activityLabelForGatewayEvent("tool.progress", { preview: "chunk 2/5" })).toBe("chunk 2/5");
  });

  it("renders persisted tool rows as done labels", () => {
    const message: SessionMessage = {
      id: 1,
      role: "tool",
      tool_name: "memory",
      content: "ok",
    };
    expect(toolNoticeLabel(message)).toBe("Saved to memory");
  });

  it("parses review and steer system notices", () => {
    expect(systemNoticeLabel("review:Routing tweak: faster path")).toBe("Routing tweak: faster path");
    expect(systemNoticeLabel("steer:stay on task")).toBe("Steered · stay on task");
  });
});
