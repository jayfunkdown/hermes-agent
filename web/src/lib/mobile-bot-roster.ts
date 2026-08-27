import { profileColor } from "@/lib/profile-color";
import type { SessionMessage } from "@/lib/api";
import { countPersistedMessages, previewFromMessages } from "@/lib/mobile-session-sync";

export const CANONICAL_CHAT_TITLE = "Bot Chat";
export const ACTIVE_WINDOW_S = 90;
export const WORKER_ACTIVE_WINDOW_S = 150;
export const BOT_ROSTER_POLL_MS = 5_000;

export const A2A_PREFIX_RE = /^Message from (?:agent '[^']+'|🤖[^:]+):\s*/i;

const AVATAR_SHAPES = ["circle", "squircle", "pill", "triangle", "hexagon", "cloud", "drop"] as const;
const PRIMARY_COLOR = "#8b5cf6";

export interface BotSessionSummary {
  id: string;
  resolved_id?: string;
  title?: string;
  preview?: string;
  started_at?: number;
  last_active: number;
  message_count?: number;
}

export interface BotWorkerSession {
  id: string;
  source?: string;
  title?: string;
  last_active: number;
}

export interface BotUiMeta {
  title?: string;
  description?: string;
  shape?: string;
  color?: string;
  image?: string;
  custom?: boolean;
  hidden?: boolean;
  pinned?: boolean;
}

export interface MobileBotRow {
  name: string;
  path?: string;
  is_default?: boolean;
  model?: string | null;
  provider?: string | null;
  description?: string | null;
  display_name?: string | null;
  title?: string | null;
  last_session?: BotSessionSummary | null;
  canonical_session?: BotSessionSummary | null;
  worker_session?: BotWorkerSession | null;
  ui_meta?: Record<string, unknown> | null;
  has_avatar?: boolean;
  handle?: string;
}

export interface ProfilesListResult {
  profiles: MobileBotRow[];
}

export function defaultShapeFor(name: string): string {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return AVATAR_SHAPES[hash % AVATAR_SHAPES.length] ?? "circle";
}

export function botRosterMeta(bot: MobileBotRow): BotUiMeta {
  const raw = bot.ui_meta?.["hermes-bots"];
  return raw && typeof raw === "object" ? (raw as BotUiMeta) : {};
}

export function isBotHidden(bot: MobileBotRow): boolean {
  return Boolean(botRosterMeta(bot).hidden);
}

export function botAppearance(name: string, meta: BotUiMeta) {
  const isPrimary = (name || "").trim().toLowerCase() === "default";
  const userCustomized = Boolean(meta.custom);
  if (isPrimary && !userCustomized) {
    return { shape: "squircle", color: PRIMARY_COLOR, image: meta.image ?? null };
  }
  return {
    shape: meta.shape || defaultShapeFor(name),
    color: meta.color || profileColor(name) || PRIMARY_COLOR,
    image: meta.image ?? null,
  };
}

export function botHandle(name: string, bot?: Pick<MobileBotRow, "handle">): string {
  if (bot?.handle && bot.handle !== name) {
    return bot.handle;
  }
  return (name || "").trim().toLowerCase() === "default" ? "hermes" : name;
}

export function displayName(bot: MobileBotRow, meta: BotUiMeta): string {
  if (meta.title?.trim()) {
    return meta.title.trim();
  }
  if (typeof bot.display_name === "string" && bot.display_name.trim()) {
    return bot.display_name.trim();
  }
  if ((bot.name || "").trim().toLowerCase() === "default" && !bot.title) {
    return "Hermes";
  }
  const raw = (bot.title || bot.name || "").replace(/[-_]+/g, " ").trim();
  return raw.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function botActivitySession(bot: MobileBotRow): BotSessionSummary | null {
  const preferred = bot.canonical_session;
  const last = bot.last_session;
  if (!preferred || !last) {
    return preferred || last || null;
  }
  return (preferred.last_active || 0) >= (last.last_active || 0) ? preferred : last;
}

export function workerActiveAt(bot: MobileBotRow, now = Date.now()): boolean {
  const ts = bot.worker_session?.last_active || 0;
  return Boolean(ts && now / 1000 - ts < WORKER_ACTIVE_WINDOW_S);
}

export function botMood(
  bot: MobileBotRow,
  options: { activeProfile: string; busyBotName: string | null },
): "work" | "idle" {
  const workerActive = workerActiveAt(bot);
  const profileKey = (bot.name || "default").trim() || "default";
  const activeKey = (options.activeProfile || "default").trim() || "default";
  const isGatewayHome = profileKey === activeKey;
  if (workerActive) return "work";
  if (isGatewayHome && options.busyBotName === profileKey) return "work";
  return "idle";
}

export function previewSessionForBot(bot: MobileBotRow): BotSessionSummary | null {
  return bot.canonical_session || bot.last_session || null;
}

export function stripAgentPreview(preview: string | null | undefined): string {
  return (preview || "").replace(A2A_PREFIX_RE, "").trim();
}

export function botRowPreview(bot: MobileBotRow): string {
  const preview = stripAgentPreview(previewSessionForBot(bot)?.preview);
  return preview || "No messages yet";
}

export function botRowStatusLabel(
  bot: MobileBotRow,
  options: { activeProfile: string; busyBotName: string | null },
): string | null {
  if (botMood(bot, options) === "work") {
    return "Working…";
  }
  return null;
}

export function canonicalChatSessionId(bot: MobileBotRow): string {
  const canonical = bot.canonical_session;
  if (!canonical) return "";
  return canonical.resolved_id || canonical.id || "";
}

export function sortBotsForHub(bots: MobileBotRow[]): MobileBotRow[] {
  return [...bots].sort((left, right) => {
    const leftMeta = botRosterMeta(left);
    const rightMeta = botRosterMeta(right);
    if (leftMeta.pinned !== rightMeta.pinned) {
      return leftMeta.pinned ? -1 : 1;
    }
    const leftActive = botActivitySession(left)?.last_active || 0;
    const rightActive = botActivitySession(right)?.last_active || 0;
    return rightActive - leftActive;
  });
}

export function botMatchesHubQuery(bot: MobileBotRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const meta = botRosterMeta(bot);
  const haystack = [
    displayName(bot, meta),
    bot.name,
    botHandle(bot.name, bot),
    bot.description ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function partitionBotsForHub(bots: MobileBotRow[], query = "") {
  const sorted = sortBotsForHub(bots);
  const visible: MobileBotRow[] = [];
  const hidden: MobileBotRow[] = [];
  for (const bot of sorted) {
    if (!botMatchesHubQuery(bot, query)) continue;
    if (isBotHidden(bot)) {
      hidden.push(bot);
    } else {
      visible.push(bot);
    }
  }
  return {
    visible,
    hidden,
    hiddenCount: bots.filter((bot) => isBotHidden(bot)).length,
  };
}

export interface BotRosterLocalBump {
  last_active: number;
  preview: string;
  message_count?: number;
}

function bumpSessionSummary(
  session: BotSessionSummary | null | undefined,
  bump: BotRosterLocalBump,
  fallbackId = "",
): BotSessionSummary {
  return {
    id: session?.id || fallbackId,
    resolved_id: session?.resolved_id,
    title: session?.title || CANONICAL_CHAT_TITLE,
    started_at: session?.started_at,
    last_active: bump.last_active,
    preview: bump.preview || session?.preview || "",
    message_count:
      bump.message_count !== undefined
        ? Math.max(session?.message_count || 0, bump.message_count)
        : session?.message_count,
  };
}

export function bumpBotInRoster(
  bots: MobileBotRow[],
  botName: string,
  messages?: SessionMessage[],
): { bots: MobileBotRow[]; bump: BotRosterLocalBump | null } {
  const preview = messages ? previewFromMessages(messages) : "";
  const bump: BotRosterLocalBump = {
    last_active: Math.floor(Date.now() / 1000),
    preview,
    message_count: messages ? countPersistedMessages(messages) : undefined,
  };

  let touched = false;
  const next = bots.map((bot) => {
    if (bot.name !== botName) return bot;
    touched = true;
    const canonical = bumpSessionSummary(bot.canonical_session, bump);
    return {
      ...bot,
      canonical_session: bot.canonical_session ? canonical : canonical,
      last_session: bot.last_session
        ? bumpSessionSummary(bot.last_session, bump, bot.last_session.id)
        : bot.last_session,
    };
  });

  if (!touched) {
    return { bots, bump };
  }

  return { bots: sortBotsForHub(next), bump };
}

export function mergeRosterWithLocalBumps(
  bots: MobileBotRow[],
  bumps: Map<string, BotRosterLocalBump>,
): MobileBotRow[] {
  if (bumps.size === 0) return bots;

  const next = bots.map((bot) => {
    const bump = bumps.get(bot.name);
    if (!bump) return bot;

    const session = botActivitySession(bot);
    const serverActive = session?.last_active || 0;
    if (serverActive >= bump.last_active) {
      return bot;
    }

    const canonical = bumpSessionSummary(bot.canonical_session, bump);
    return {
      ...bot,
      canonical_session: bot.canonical_session ? canonical : canonical,
      last_session: bot.last_session
        ? bumpSessionSummary(bot.last_session, bump, bot.last_session.id)
        : bot.last_session,
    };
  });

  return sortBotsForHub(next);
}

export function pruneCaughtUpRosterBumps(
  bots: MobileBotRow[],
  bumps: Map<string, BotRosterLocalBump>,
): void {
  for (const [name, bump] of bumps) {
    const bot = bots.find((row) => row.name === name);
    if (!bot) continue;
    const serverActive = botActivitySession(bot)?.last_active || 0;
    if (serverActive >= bump.last_active) {
      bumps.delete(name);
    }
  }
}

export function activityLabelForGatewayEvent(type: string, payload: unknown): string | null {
  const data =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  switch (type) {
    case "thinking.delta":
      return "Thinking…";
    case "tool.start":
      return typeof data.name === "string" ? `Running ${data.name}` : "Running tool";
    case "tool.progress":
      return typeof data.message === "string" ? data.message : "Tool in progress";
    case "tool.complete":
      return typeof data.name === "string" ? `Finished ${data.name}` : "Tool finished";
    case "tool.generating":
      return typeof data.name === "string" ? `Drafting ${data.name}…` : "Generating…";
    case "status.update":
      return typeof data.message === "string" ? data.message : "Status update";
    case "message.interim":
      return typeof data.text === "string" ? data.text : "Drafting reply…";
    default:
      return null;
  }
}
