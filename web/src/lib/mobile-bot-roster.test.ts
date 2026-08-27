import { describe, expect, it } from "vitest";

import {
  activityLabelForGatewayEvent,
  botHandle,
  botMood,
  botRowPreview,
  canonicalChatSessionId,
  displayName,
  partitionBotsForHub,
  sortBotsForHub,
  stripAgentPreview,
  type MobileBotRow,
} from "@/lib/mobile-bot-roster";

function bot(overrides: Partial<MobileBotRow> = {}): MobileBotRow {
  return {
    name: "alpha",
    ...overrides,
  };
}

describe("mobile-bot-roster", () => {
  it("uses desktop-style display names and handles", () => {
    expect(displayName(bot({ name: "default" }), {})).toBe("Hermes");
    expect(botHandle("default")).toBe("hermes");
    expect(botHandle("alpha")).toBe("alpha");
    expect(displayName(bot({ name: "alpha", ui_meta: { "hermes-bots": { title: "Alpha Bot" } } }), { title: "Alpha Bot" })).toBe(
      "Alpha Bot",
    );
  });

  it("prefers canonical session id for chat routing", () => {
    const row = bot({
      canonical_session: { id: "stored-id", resolved_id: "live-id", last_active: 10 },
    });
    expect(canonicalChatSessionId(row)).toBe("live-id");
  });

  it("strips agent-to-agent preview prefixes", () => {
    expect(stripAgentPreview("Message from agent 'beta': hello there")).toBe("hello there");
    expect(botRowPreview(bot({ canonical_session: { id: "s1", last_active: 1, preview: "Message from 🤖 beta: ping" } }))).toBe(
      "ping",
    );
  });

  it("marks gateway-home bots as working when busy", () => {
    const row = bot({ name: "alpha" });
    expect(botMood(row, { activeProfile: "alpha", busyBotName: "alpha" })).toBe("work");
    expect(botMood(row, { activeProfile: "beta", busyBotName: "alpha" })).toBe("idle");
  });

  it("sorts pinned bots ahead of recency", () => {
    const rows = sortBotsForHub([
      bot({ name: "recent", canonical_session: { id: "r", last_active: 100 } }),
      bot({
        name: "pinned",
        canonical_session: { id: "p", last_active: 1 },
        ui_meta: { "hermes-bots": { pinned: true } },
      }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(["pinned", "recent"]);
  });

  it("partitions hidden bots into a recoverable hidden section", () => {
    const rows = partitionBotsForHub([
      bot({ name: "alpha" }),
      bot({ name: "ghost", ui_meta: { "hermes-bots": { hidden: true } } }),
    ]);
    expect(rows.visible.map((row) => row.name)).toEqual(["alpha"]);
    expect(rows.hidden.map((row) => row.name)).toEqual(["ghost"]);
    expect(rows.hiddenCount).toBe(1);
  });

  it("filters hidden and visible bots together when searching", () => {
    const rows = partitionBotsForHub(
      [
        bot({ name: "alpha", ui_meta: { "hermes-bots": { title: "Alpha" } } }),
        bot({ name: "ghost", ui_meta: { "hermes-bots": { hidden: true, title: "Ghost" } } }),
      ],
      "ghost",
    );
    expect(rows.visible).toHaveLength(0);
    expect(rows.hidden.map((row) => row.name)).toEqual(["ghost"]);
  });

  it("maps gateway activity events to labels", () => {
    expect(activityLabelForGatewayEvent("tool.start", { name: "memory" })).toBe("Running memory");
    expect(activityLabelForGatewayEvent("tool.generating", { name: "reply" })).toBe("Drafting reply…");
    expect(activityLabelForGatewayEvent("status.update", { message: "Writing memory…" })).toBe("Writing memory…");
  });
});
