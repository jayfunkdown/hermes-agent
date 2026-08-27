import { BotFace } from "@/components/mobile/BotFace";
import { Markdown } from "@/components/Markdown";
import { useAgentAvatar } from "@/hooks/useAgentAvatar";
import type { GatewayClient } from "@/lib/gatewayClient";
import { isBackfilledFacePng } from "@/lib/bot-face-math";
import type { MobileBotRow } from "@/lib/mobile-bot-roster";
import { cn } from "@/lib/utils";

const NOTICE_CLASS =
  "flex max-w-[min(86%,44rem)] flex-col gap-0.5 self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-text-tertiary/60";

interface AgentGlyphProps {
  handle: string;
  gateway: GatewayClient | null;
  rosterAvatars?: Record<string, string>;
  bots?: MobileBotRow[];
}

function AgentGlyph({ handle, gateway, rosterAvatars, bots }: AgentGlyphProps) {
  const { image, bot, appearance } = useAgentAvatar(handle, gateway, { rosterAvatars, bots });
  const photo = Boolean(image && !isBackfilledFacePng(image));

  if (photo && image) {
    return (
      <img
        src={image}
        alt=""
        aria-hidden
        className="size-4 shrink-0 rounded-full object-cover"
      />
    );
  }

  if (bot && appearance) {
    return (
      <BotFace
        shape={appearance.shape}
        color={appearance.color}
        image={appearance.image}
        name={bot.name}
        mood="idle"
        size={16}
        className="shrink-0"
      />
    );
  }

  return (
    <span aria-hidden className="text-[0.8125rem] leading-none">
      🤖
    </span>
  );
}

interface AgentDeliveryNoticeProps {
  sender: string;
  handle: string;
  body: string;
  gateway: GatewayClient | null;
  rosterAvatars?: Record<string, string>;
  bots?: MobileBotRow[];
}

/** Receiving-side compact notice: "Message from {sender}" + disclosed body. */
export function AgentDeliveryNotice({
  sender,
  handle,
  body,
  gateway,
  rosterAvatars,
  bots,
}: AgentDeliveryNoticeProps) {
  return (
    <article className="flex w-full justify-center">
      <div className={NOTICE_CLASS} data-slot="mobile-agent-message-note">
        <span className="flex items-center justify-center gap-1.5">
          <AgentGlyph
            handle={handle}
            gateway={gateway}
            rosterAvatars={rosterAvatars}
            bots={bots}
          />
          <span className="wrap-anywhere">Message from {sender}</span>
        </span>
        {body ? (
          <details className="self-center">
            <summary
              className={cn(
                "cursor-pointer select-none text-center text-text-tertiary/45",
                "hover:text-text-tertiary/70",
              )}
            >
              show message
            </summary>
            <div className="mt-1 max-w-[36rem] whitespace-pre-wrap rounded-lg border border-border/60 px-3 py-2 text-left text-[0.75rem] leading-5 text-foreground/85">
              <Markdown content={body} />
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

interface AgentDeliveryToolNoticeProps {
  target: string;
  pending: boolean;
  replyBody: string;
  gateway: GatewayClient | null;
  rosterAvatars?: Record<string, string>;
  bots?: MobileBotRow[];
}

/** Sender-side compact notice: "Messaged X" / "Message from X" after terminal delivery. */
export function AgentDeliveryToolNotice({
  target,
  pending,
  replyBody,
  gateway,
  rosterAvatars,
  bots,
}: AgentDeliveryToolNoticeProps) {
  return (
    <article className="flex w-full min-w-0 flex-col items-stretch gap-0.5">
      <div className={NOTICE_CLASS} data-slot="mobile-agent-delivery-notice">
        <span className="flex items-center justify-center gap-1.5">
          <AgentGlyph
            handle={target}
            gateway={gateway}
            rosterAvatars={rosterAvatars}
            bots={bots}
          />
          <span className="wrap-anywhere">
            {pending ? "Messaging" : "Messaged"} {target}
            {pending ? "…" : ""}
          </span>
        </span>
      </div>
      {!pending && replyBody ? (
        <div className={NOTICE_CLASS} data-slot="mobile-agent-reply-notice">
          <span className="flex items-center justify-center gap-1.5">
            <AgentGlyph
              handle={target}
              gateway={gateway}
              rosterAvatars={rosterAvatars}
              bots={bots}
            />
            <span className="wrap-anywhere">Message from {target}</span>
          </span>
          <details className="self-center">
            <summary
              className={cn(
                "cursor-pointer select-none text-center text-text-tertiary/45",
                "hover:text-text-tertiary/70",
              )}
            >
              show message
            </summary>
            <div className="mt-1 max-w-[36rem] whitespace-pre-wrap rounded-lg border border-border/60 px-3 py-2 text-left text-[0.75rem] leading-5 text-foreground/85">
              {replyBody}
            </div>
          </details>
        </div>
      ) : null}
    </article>
  );
}
