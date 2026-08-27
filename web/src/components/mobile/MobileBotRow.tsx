import { EyeOff } from "lucide-react";

import { BotFace } from "@/components/mobile/BotFace";
import {
  botAppearance,
  botHandle,
  botMood,
  botRosterMeta,
  botRowPreview,
  botRowStatusLabel,
  displayName,
  type MobileBotRow,
} from "@/lib/mobile-bot-roster";
import { cn, timeAgo } from "@/lib/utils";

interface MobileBotRowProps {
  bot: MobileBotRow;
  active: boolean;
  hidden?: boolean;
  avatarUrl?: string | null;
  activeProfile: string;
  busyBotName: string | null;
  onClick: () => void;
}

export function MobileBotRow({
  bot,
  active,
  hidden = false,
  avatarUrl,
  activeProfile,
  busyBotName,
  onClick,
}: MobileBotRowProps) {
  const meta = botRosterMeta(bot);
  const { shape, color, image } = botAppearance(bot.name, meta);
  const mood = botMood(bot, { activeProfile, busyBotName });
  const statusLabel = botRowStatusLabel(bot, { activeProfile, busyBotName });
  const preview = statusLabel || botRowPreview(bot);
  const handle = botHandle(bot.name, bot);
  const lastActive = bot.canonical_session?.last_active || bot.last_session?.last_active || 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 border-b border-current/5 px-4 py-3 text-left transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/30",
        hidden && "opacity-70",
      )}
    >
      <div className={cn("shrink-0", hidden && "grayscale")}>
        <BotFace
          shape={shape}
          color={color}
          image={avatarUrl || image}
          name={bot.name}
          mood={mood}
          size={48}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium text-foreground">
            {displayName(bot, meta)}
          </span>
          {hidden ? <EyeOff className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-label="Hidden from roster" /> : null}
          {lastActive ? (
            <span className="shrink-0 text-[0.7rem] text-text-tertiary">
              {timeAgo(lastActive)}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[0.68rem] text-text-tertiary">@{handle}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-tertiary">{preview}</span>
          {mood === "work" ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-success animate-pulse" aria-label="Live" />
          ) : null}
        </div>
      </div>
    </button>
  );
}
