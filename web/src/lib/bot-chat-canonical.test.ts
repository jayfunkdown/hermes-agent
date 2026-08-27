import { describe, expect, it } from "vitest";

import {
  CANONICAL_BOT_CHAT_TITLE,
  canonicalSessionCreateParams,
  canonicalSessionListParams,
} from "@/lib/bot-chat-canonical";

describe("bot-chat-canonical", () => {
  it("uses the exact Bot Mode forever-chat title", () => {
    expect(CANONICAL_BOT_CHAT_TITLE).toBe("Bot Chat");
  });

  it("matches desktop session.list lookup params", () => {
    expect(canonicalSessionListParams("boss-bot")).toEqual({
      profile: "boss-bot",
      title: "Bot Chat",
      include_hidden: true,
    });
    expect(canonicalSessionListParams("default")).toEqual({
      title: "Bot Chat",
      include_hidden: true,
    });
  });

  it("matches desktop session.create params for new canonical chats", () => {
    expect(canonicalSessionCreateParams("dev")).toEqual({
      profile: "dev",
      title: "Bot Chat",
      include_hidden: true,
      hidden: true,
    });
  });
});
