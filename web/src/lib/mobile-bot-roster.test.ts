import { describe, expect, it } from "vitest";

import {
  activityLabelForGatewayEvent,
  botHandle,
  botMood,
  botRowPreview,
  botRowStatusLabel,
  canonicalChatSessionId,
  displayName,
  formatMobileError,
  isBotHidden,
  isSessionNotFoundError,
  rosterDefaultOnlyWarning,
  rosterLoadIncomplete,
  rosterOnlyDefault,
  rosterOnlyHiddenDefault,
  sortBotsForHub,
  splitRosterByHidden,
  stripAgentPreview,
  type MobileBotRow,
} from "@/lib/mobile-bot-roster";

function bot(overrides: Partial<MobileBotRow> = {}): MobileBotRow {
  return {
    name: "alpha",
    ...overrides,
  };
}

function jasonScenario(): MobileBotRow[] {
  return [
    bot({
      name: "default",
      ui_meta: { "hermes-bots": { title: "Hermes", hidden: true } },
      canonical_session: { id: "stale-default", last_active: 1, preview: "OK" },
    }),
    bot({
      name: "boss-bot",
      ui_meta: { "hermes-bots": { title: "Point man" } },
      canonical_session: { id: "boss-chat", last_active: 100 },
    }),
    bot({ name: "dev", canonical_session: { id: "dev-chat", last_active: 90 } }),
    bot({ name: "bsv-ops", canonical_session: { id: "bsv-chat", last_active: 80 } }),
    bot({ name: "assistant", canonical_session: { id: "asst-chat", last_active: 70 } }),
    bot({ name: "mainline", canonical_session: { id: "main-chat", last_active: 60 } }),
  ];
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

  it("maps gateway activity events to labels", () => {
    expect(activityLabelForGatewayEvent("tool.start", { name: "memory" })).toBe("Saving to memory");
    expect(activityLabelForGatewayEvent("tool.complete", { name: "memory" })).toBe("Saved to memory");
    expect(activityLabelForGatewayEvent("tool.generating", { name: "reply" })).toBe("Drafting reply…");
    expect(activityLabelForGatewayEvent("status.update", { text: "Writing memory…" })).toBe("Writing memory…");
    expect(activityLabelForGatewayEvent("status.update", { kind: "compacting" })).toBe("Summarizing thread");
    expect(activityLabelForGatewayEvent("review.summary", { text: "updated skill routing" })).toBe(
      "Self-improvement review: updated skill routing",
    );
  });

  it("shows latest activity label on busy bot rows", () => {
    const row = bot({ name: "alpha" });
    expect(
      botRowStatusLabel(row, {
        activeProfile: "alpha",
        busyBotName: "alpha",
        activityLabel: "Saving to memory",
      }),
    ).toBe("Saving to memory");
    expect(
      botRowStatusLabel(row, {
        activeProfile: "alpha",
        busyBotName: "alpha",
        activityLabel: null,
      }),
    ).toBe("Working…");
  });

  it("reads hidden flag from ui_meta hermes-bots (desktop parity)", () => {
    const hidden = bot({ ui_meta: { "hermes-bots": { hidden: true } } });
    const visible = bot({ ui_meta: { "hermes-bots": { hidden: false } } });
    expect(isBotHidden(hidden)).toBe(true);
    expect(isBotHidden(visible)).toBe(false);
  });

  it("Jason scenario: five active agents, hidden default not in active hub", () => {
    const roster = jasonScenario();
    const { visible, hidden } = splitRosterByHidden(roster);
    expect(visible.map((row) => row.name)).toEqual([
      "boss-bot",
      "dev",
      "bsv-ops",
      "assistant",
      "mainline",
    ]);
    expect(hidden.map((row) => row.name)).toEqual(["default"]);
    expect(visible.some((row) => row.name === "default")).toBe(false);
  });

  it("only-hidden roster is incomplete — do not treat as active hub", () => {
    const onlyHidden = [
      bot({ name: "default", ui_meta: { "hermes-bots": { hidden: true } } }),
    ];
    expect(rosterOnlyHiddenDefault(onlyHidden)).toBe(true);
    const { visible } = splitRosterByHidden(onlyHidden);
    expect(visible).toHaveLength(0);
    expect(rosterLoadIncomplete(onlyHidden, visible)).toBe(true);
  });

  it("default-only visible roster shows sync warning (not healthy hub)", () => {
    const onlyDefault = [
      bot({
        name: "default",
        handle: "hermes",
        ui_meta: { "hermes-bots": { title: "Hermes", hidden: false } },
        canonical_session: { id: "stale", last_active: 1, preview: "OK" },
      }),
    ];
    const { visible } = splitRosterByHidden(onlyDefault);
    expect(visible).toHaveLength(1);
    expect(rosterLoadIncomplete(onlyDefault, visible)).toBe(false);
    expect(rosterDefaultOnlyWarning(onlyDefault)).toBe(true);
    expect(rosterOnlyDefault(onlyDefault)).toBe(true);
  });

  it("formatMobileError never surfaces raw 404 session detail", () => {
    expect(formatMobileError("404: {detail:Session not found}")).not.toContain("404:");
    expect(formatMobileError("404: {detail:Session not found}")).not.toContain("{detail:");
    expect(formatMobileError("404: {detail:Session not found}")).not.toContain("Session not found");
    expect(isSessionNotFoundError("404: {detail:Session not found}")).toBe(true);
  });
});
