import type { SessionMessage } from "@/lib/api";
import {
  deliveryTargetFromCommand,
  isAgentDeliveryMessage,
  parseAgentMessage,
  parseTerminalToolArgs,
  replyTextFromResult,
  type ParsedAgentMessage,
} from "@/lib/agent-delivery";

export interface AgentSendDelivery {
  target: string;
  pending: boolean;
  replyBody: string;
}

export type MobileRenderedMessage =
  | { kind: "chat"; message: SessionMessage; key: string }
  | { kind: "agent-receive"; message: SessionMessage; parsed: ParsedAgentMessage; key: string }
  | { kind: "agent-send"; message: SessionMessage; delivery: AgentSendDelivery; key: string };

export function renderMobileSessionMessages(messages: SessionMessage[]): MobileRenderedMessage[] {
  const consumedToolCallIds = new Set<string>();
  const rendered: MobileRenderedMessage[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.display_kind === "hidden") continue;

    const body = message.content?.trim() ?? "";

    if (message.role === "user" && isAgentDeliveryMessage(body)) {
      const parsed = parseAgentMessage(body);
      if (parsed) {
        rendered.push({
          kind: "agent-receive",
          message,
          parsed,
          key: `agent-receive-${message.id ?? index}`,
        });
        continue;
      }
    }

    if (message.role === "assistant" && message.tool_calls?.length) {
      let deliveryRendered = false;
      for (const call of message.tool_calls) {
        if (call.function?.name !== "terminal") continue;
        const target = deliveryTargetFromCommand(parseTerminalToolArgs(call.function.arguments).command ?? "");
        if (!target) continue;

        const resultMessage = messages
          .slice(index + 1)
          .find((candidate) => candidate.role === "tool" && candidate.tool_call_id === call.id);

        if (resultMessage?.tool_call_id) {
          consumedToolCallIds.add(resultMessage.tool_call_id);
        }

        let replyBody = "";
        if (resultMessage?.content) {
          const raw = replyTextFromResult(resultMessage.content);
          replyBody = parseAgentMessage(raw)?.body ?? raw;
        }

        rendered.push({
          kind: "agent-send",
          message,
          delivery: {
            target,
            pending: !resultMessage,
            replyBody,
          },
          key: `agent-send-${message.id ?? index}-${call.id}`,
        });
        deliveryRendered = true;
      }

      if (deliveryRendered && !body) {
        continue;
      }
    }

    if (message.role === "tool" && message.tool_call_id && consumedToolCallIds.has(message.tool_call_id)) {
      continue;
    }

    rendered.push({
      kind: "chat",
      message,
      key: `chat-${message.id ?? index}-${message.role}`,
    });
  }

  return rendered;
}
