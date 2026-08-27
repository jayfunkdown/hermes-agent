import { useCallback, useEffect, useRef, useState } from "react";

import type { GatewayClient } from "@/lib/gatewayClient";
import type { SessionMessage } from "@/lib/api";
import type { GatewayEvent } from "@hermes/shared";
import {
  activityLabelForGatewayEvent,
  BOT_ROSTER_POLL_MS,
  bumpBotInRoster,
  CANONICAL_CHAT_TITLE,
  mergeRosterWithLocalBumps,
  pruneCaughtUpRosterBumps,
  sortBotsForHub,
  type BotRosterLocalBump,
  type MobileBotRow,
  type ProfilesListResult,
} from "@/lib/mobile-bot-roster";

const ROSTER_EVENT_DEBOUNCE_MS = 400;

export function useMobileBotRoster(gateway: GatewayClient | null) {
  const [bots, setBots] = useState<MobileBotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const avatarFetchedRef = useRef<Set<string>>(new Set());
  const localBumpsRef = useRef<Map<string, BotRosterLocalBump>>(new Map());
  const rosterRefreshTimerRef = useRef<number | null>(null);
  const wasConnectedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!gateway || gateway.connectionState !== "open") {
      return;
    }
    setError(null);
    try {
      const result = await gateway.request<ProfilesListResult>("profiles.list", {});
      const roster = sortBotsForHub(result.profiles ?? []);
      pruneCaughtUpRosterBumps(roster, localBumpsRef.current);
      const merged = mergeRosterWithLocalBumps(roster, localBumpsRef.current);
      setBots(merged);

      for (const bot of merged) {
        if (!bot.has_avatar) {
          avatarFetchedRef.current.delete(bot.name);
          continue;
        }
        if (avatarFetchedRef.current.has(bot.name)) {
          continue;
        }
        avatarFetchedRef.current.add(bot.name);
        try {
          const asset = await gateway.request<{ data?: string }>("profiles.get_asset", {
            name: bot.name,
            asset: "avatar",
          });
          if (asset?.data) {
            setAvatars((prev) => ({ ...prev, [bot.name]: asset.data! }));
          }
        } catch {
          avatarFetchedRef.current.delete(bot.name);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  const scheduleRefresh = useCallback(() => {
    if (rosterRefreshTimerRef.current !== null) {
      window.clearTimeout(rosterRefreshTimerRef.current);
    }
    rosterRefreshTimerRef.current = window.setTimeout(() => {
      rosterRefreshTimerRef.current = null;
      void refresh();
    }, ROSTER_EVENT_DEBOUNCE_MS);
  }, [refresh]);

  const bumpBotFromMessages = useCallback((botName: string, messages: SessionMessage[]) => {
    if (!botName) return;
    setBots((prev) => {
      const { bots: bumped, bump } = bumpBotInRoster(prev, botName, messages);
      if (bump) {
        localBumpsRef.current.set(botName, bump);
      }
      return bumped;
    });
  }, []);

  useEffect(() => {
    if (!gateway) return;
    let cancelled = false;
    const connect = async () => {
      try {
        if (gateway.connectionState !== "open") {
          await gateway.connect();
        }
        if (!cancelled) {
          await refresh();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };
    void connect();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, BOT_ROSTER_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const connectionTimer = window.setInterval(() => {
      const open = gateway.connectionState === "open";
      if (open && !wasConnectedRef.current) {
        void refresh();
      }
      wasConnectedRef.current = open;
    }, 1_000);

    const shouldRefreshFromEvent = (event: GatewayEvent) => {
      const type = event.type;
      return (
        type === "message.complete" ||
        type === "message.start" ||
        type === "status.update" ||
        type === "tool.complete"
      );
    };

    const unsubs = [
      gateway.on("message.complete", (event) => {
        if (shouldRefreshFromEvent(event)) scheduleRefresh();
      }),
      gateway.on("message.start", (event) => {
        if (shouldRefreshFromEvent(event)) scheduleRefresh();
      }),
      gateway.on("status.update", (event) => {
        if (shouldRefreshFromEvent(event)) scheduleRefresh();
      }),
      gateway.on("tool.complete", (event) => {
        if (shouldRefreshFromEvent(event)) scheduleRefresh();
      }),
    ];

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearInterval(connectionTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (rosterRefreshTimerRef.current !== null) {
        window.clearTimeout(rosterRefreshTimerRef.current);
      }
      for (const unsub of unsubs) unsub();
    };
  }, [gateway, refresh, scheduleRefresh]);

  return { bots, loading, error, avatars, refresh, bumpBotFromMessages };
}

export async function ensureCanonicalChat(
  gateway: GatewayClient,
  profileName: string,
): Promise<string> {
  const profile = profileName.trim() || undefined;
  const listed = await gateway.request<{ sessions?: Array<{ id: string }> }>("session.list", {
    ...(profile ? { profile } : {}),
    title: CANONICAL_CHAT_TITLE,
    include_hidden: true,
  });
  const existing = listed.sessions?.[0]?.id;
  if (existing) {
    return existing;
  }
  const created = await gateway.request<{ session_id: string }>("session.create", {
    ...(profile ? { profile } : {}),
    title: CANONICAL_CHAT_TITLE,
    hidden: true,
  });
  return created.session_id;
}

export interface AgentActivityItem {
  id: string;
  label: string;
  at: number;
}

export function useMobileBotActivity(
  gateway: GatewayClient | null,
  sessionId: string,
  profileName: string,
) {
  const [busy, setBusy] = useState(false);
  const [activities, setActivities] = useState<AgentActivityItem[]>([]);

  useEffect(() => {
    if (!gateway || !sessionId || gateway.connectionState !== "open") {
      setBusy(false);
      setActivities([]);
      return;
    }

    const pushActivity = (type: string, event: GatewayEvent) => {
      const label = activityLabelForGatewayEvent(type, event.payload);
      if (!label) return;
      setActivities((prev) => [
        ...prev.slice(-12),
        { id: `${type}-${Date.now()}-${prev.length}`, label, at: Date.now() },
      ]);
    };

    const matches = (event: GatewayEvent) => {
      if (event.session_id && event.session_id !== sessionId) {
        return false;
      }
      if (event.profile && profileName && event.profile !== profileName) {
        return false;
      }
      return true;
    };

    const unsubs = [
      gateway.on("message.start", (event) => {
        if (!matches(event)) return;
        setBusy(true);
      }),
      gateway.on("message.complete", (event) => {
        if (!matches(event)) return;
        setBusy(false);
      }),
      gateway.on("thinking.delta", (event) => {
        if (!matches(event)) return;
        pushActivity("thinking.delta", event);
        setBusy(true);
      }),
      gateway.on("tool.start", (event) => {
        if (!matches(event)) return;
        pushActivity("tool.start", event);
        setBusy(true);
      }),
      gateway.on("tool.generating", (event) => {
        if (!matches(event)) return;
        pushActivity("tool.generating", event);
        setBusy(true);
      }),
      gateway.on("tool.progress", (event) => {
        if (!matches(event)) return;
        pushActivity("tool.progress", event);
      }),
      gateway.on("tool.complete", (event) => {
        if (!matches(event)) return;
        pushActivity("tool.complete", event);
      }),
      gateway.on("status.update", (event) => {
        if (!matches(event)) return;
        pushActivity("status.update", event);
      }),
      gateway.on("message.interim", (event) => {
        if (!matches(event)) return;
        pushActivity("message.interim", event);
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
      setBusy(false);
      setActivities([]);
    };
  }, [gateway, profileName, sessionId]);

  return { busy, activities };
}
