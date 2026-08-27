import { describe, expect, it } from "vitest";

import {
  AGENT_MESSAGE_RE,
  deliveryTargetFromCommand,
  isAgentDeliveryMessage,
  parseAgentMessage,
  replyTextFromResult,
} from "@/lib/agent-delivery";
import { renderMobileSessionMessages } from "@/lib/mobile-agent-delivery-render";
import type { SessionMessage } from "@/lib/api";

describe("agent-delivery", () => {
  it("matches Bot Mode delivery prefix with sender and body", () => {
    const match = AGENT_MESSAGE_RE.exec("Message from 🤖 Hermes: hello there");
    expect(match?.[1]?.trim()).toBe("Hermes");
    expect(match?.[4]).toBe("hello there");
  });

  it("captures the @handle when present", () => {
    const parsed = parseAgentMessage("Message from 🤖 Eats Tests (@mr-tester): run them all");
    expect(parsed?.sender).toBe("Eats Tests");
    expect(parsed?.handle).toBe("mr-tester");
    expect(parsed?.body).toBe("run them all");
  });

  it("does not match prose that merely contains the phrase", () => {
    expect(isAgentDeliveryMessage("I got a Message from 🤖 Hermes: earlier")).toBe(false);
  });

  it("detects canonical delivery commands", () => {
    const cmd =
      'hermes -p turqoise chat --in ~ -c "Bot Chat" -Q -q "Message from 🤖 Hermes (@hermes): hi there"';
    expect(deliveryTargetFromCommand(cmd)).toBe("turqoise");
  });

  it("strips session_id bookkeeping from terminal replies", () => {
    const output = "session_id: 20260813_220347_f69ac6\nHi Hermes! Good to hear from you.";
    expect(replyTextFromResult({ output })).toBe("Hi Hermes! Good to hear from you.");
  });
});

describe("renderMobileSessionMessages", () => {
  it("renders agent deliveries as compact notices instead of user bubbles", () => {
    const messages: SessionMessage[] = [
      {
        id: 1,
        role: "user",
        content: "Message from 🤖 dev (@dev): secret payload",
      },
    ];
    const rendered = renderMobileSessionMessages(messages);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.kind).toBe("agent-receive");
    if (rendered[0]?.kind === "agent-receive") {
      expect(rendered[0].parsed.sender).toBe("dev");
      expect(rendered[0].parsed.body).toBe("secret payload");
    }
  });

  it("renders sender-side terminal delivery with reply disclosure", () => {
    const messages: SessionMessage[] = [
      {
        id: 2,
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "terminal",
              arguments: JSON.stringify({
                command: 'hermes -p dev chat -q "Message from 🤖 Hermes: ping"',
              }),
            },
          },
        ],
      },
      {
        id: 3,
        role: "tool",
        tool_call_id: "call-1",
        content: JSON.stringify({ output: "session_id: abc\nack from dev" }),
      },
    ];
    const rendered = renderMobileSessionMessages(messages);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.kind).toBe("agent-send");
    if (rendered[0]?.kind === "agent-send") {
      expect(rendered[0].delivery.target).toBe("dev");
      expect(rendered[0].delivery.replyBody).toBe("ack from dev");
    }
  });

  it("renders persisted tool activity as compact notices", () => {
    const messages: SessionMessage[] = [
      {
        id: 4,
        role: "tool",
        tool_name: "memory",
        content: "saved",
      },
      {
        id: 5,
        role: "system",
        content: "review:Self-improvement review: tuned routing",
      },
    ];
    const rendered = renderMobileSessionMessages(messages);
    expect(rendered).toHaveLength(2);
    expect(rendered[0]?.kind).toBe("activity-notice");
    if (rendered[0]?.kind === "activity-notice") {
      expect(rendered[0].label).toBe("Saved to memory");
    }
    expect(rendered[1]?.kind).toBe("activity-notice");
    if (rendered[1]?.kind === "activity-notice") {
      expect(rendered[1].label).toContain("Self-improvement review");
    }
  });
});
