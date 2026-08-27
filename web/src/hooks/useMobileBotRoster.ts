import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, type SessionMessage } from "@/lib/api";
import type { GatewayClient } from "@/lib/gatewayClient";
import type { GatewayEvent } from "@hermes/shared";
import {
  activityLabelForGatewayEvent,
  BOT_ROSTER_POLL_MS,
  bumpBotInRoster,
  CANONICAL_CHAT_TITLE,
  mergeRosterWithLocalBumps,
  pruneCaughtUpRosterBumps,
  rosterDefaultOnlyWarning,
  rosterLoadIncomplete,
  splitRosterByHidden,
  type BotRosterLocalBump,
  type MobileBotRow,
  type ProfilesListResult,
} from "@/lib/mobile-bot-roster";
import { isPendingActivityType } from "@/lib/mobile-activity-notices";

const ROSTER_EVENT_DEBOUNCE_MS = 400;

function normalizeRosterRows(profiles: unknown): MobileBotRow[] {
  if (!Array.isArray(profiles)) return [];
  return profiles.filter((row): row is MobileBotRow => {
    return Boolean(row && typeof row === "object" && typeof (row as MobileBotRow).name === "string");
  });
}

export function useMobileBotRoster(gateway: GatewayClient | null) {
  const [allBots, setAllBots] = useState<MobileBotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rosterMeta, setRosterMeta] = useState<{
    defaultOnly: boolean;
    incomplete: boolean;
    source: string | null;
  }>({ defaultOnly: false, incomplete: false, source: null });
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const avatarFetchedRef = useRef<Set<string>>(new Set());
  const localBumpsRef = useRef<Map<string, BotRosterLocalBump>>(new Map());
  const rosterRefreshTimerRef = useRef<number | null>(null);
  const rosterRevisionRef = useRef(0);
  const rosterLoadedRef = useRef(false);

  const { visible: visibleBots, hidden: hiddenBots } = useMemo(
    () => splitRosterByHidden(allBots),
    [allBots],
  );

  const rosterIncomplete = useMemo(
    () => rosterMeta.incomplete || rosterLoadIncomplete(allBots, visibleBots),
    [allBots, rosterMeta.incomplete, visibleBots],
  );

  const defaultOnlyWarning = useMemo(
    () => rosterMeta.defaultOnly || rosterDefaultOnlyWarning(allBots),
    [allBots, rosterMeta.defaultOnly],
  );

  const refreshAvatars = useCallback(async (profiles: MobileBotRow[]) => {
    for (const bot of profiles) {
      if (!bot.has_avatar) {
        avatarFetchedRef.current.delete(bot.name);
        continue;
      }
      if (avatarFetchedRef.current.has(bot.name)) {
        continue;
      }
      avatarFetchedRef.current.add(bot.name);
      try {
        const asset = await api.getProfileAvatar(bot.name);
        if (asset?.data) {
          setAvatars((prev) => ({ ...prev, [bot.name]: asset.data! }));
        }
      } catch {
        avatarFetchedRef.current.delete(bot.name);
      }
    }
  }, []);

  const applyRosterRows = useCallback(
    (profiles: MobileBotRow[], meta: typeof rosterMeta) => {
      pruneCaughtUpRosterBumps(profiles, localBumpsRef.current);
      const merged = mergeRosterWithLocalBumps(profiles, localBumpsRef.current);
      setAllBots(merged);
      setRosterMeta(meta);
      void refreshAvatars(merged);
    },
    [refreshAvatars],
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      let profiles: MobileBotRow[] = [];
      let meta = { defaultOnly: false, incomplete: false, source: "rest" as string | null };

      try {
        const rest = await api.getMobileRoster(
          true,
          rosterLoadedRef.current ? rosterRevisionRef.current : undefined,
        );
        rosterLoadedRef.current = true;
        if (rest.revision && rest.revision > rosterRevisionRef.current) {
          rosterRevisionRef.current = rest.revision;
        }
        if (rest.unchanged) {
          setAllBots((prev) => {
            pruneCaughtUpRosterBumps(prev, localBumpsRef.current);
            return mergeRosterWithLocalBumps(prev, localBumpsRef.current);
          });
          return;
        }
        profiles = normalizeRosterRows(rest.profiles);
        meta = {
          defaultOnly: Boolean(rest.default_only),
          incomplete: Boolean(rest.incomplete || rest.default_only),
          source: rest.source || "rest",
        };
      } catch {
        if (!gateway || gateway.connectionState !== "open") {
          throw new Error("Could not load Bot Mode roster");
        }
        const result = await gateway.request<ProfilesListResult>("profiles.list", {
          include_sessions: true,
        });
        profiles = normalizeRosterRows(result.profiles);
        meta = {
          defaultOnly: profiles.length === 1 && profiles[0]?.name === "default",
          incomplete: profiles.length === 1 && profiles[0]?.name === "default",
          source: "gateway",
        };
      }

      applyRosterRows(profiles, meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [applyRosterRows, gateway]);

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
    setAllBots((prev) => {
      const { bots: bumped, bump } = bumpBotInRoster(prev, botName, messages);
      if (bump) {
        localBumpsRef.current.set(botName, bump);
      }
      return bumped;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
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
    void load();

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

    const shouldRefreshFromEvent = (event: GatewayEvent) => {
      const type = event.type;
      return (
        type === "message.complete" ||
        type === "message.start" ||
        type === "status.update" ||
        type === "tool.complete"
      );
    };

    const unsubs = gateway
      ? [
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
        ]
      : [];

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (rosterRefreshTimerRef.current !== null) {
        window.clearTimeout(rosterRefreshTimerRef.current);
      }
      for (const unsub of unsubs) unsub();
    };
  }, [gateway, refresh, scheduleRefresh]);

  return {
    allBots,
    bots: visibleBots,
    hiddenBots,
    rosterIncomplete,
    defaultOnlyWarning,
    rosterSource: rosterMeta.source,
    loading,
    error,
    avatars,
    refresh,
    bumpBotFromMessages,
  };
}

/** Adopt/create canonical Bot Chat by profile name — never trust stale session pointers. */
export async function ensureCanonicalChat(
  gateway: GatewayClient,
  profileName: string,
): Promise<string> {
  const profile = profileName.trim() || undefined;
  const listed = await gateway.request<{ sessions?: Array<{ id: string; resolved_id?: string }> }>(
    "session.list",
    {
      ...(profile ? { profile } : {}),
      title: CANONICAL_CHAT_TITLE,
      include_hidden: true,
    },
  );
  const existing = listed.sessions?.[0];
  const sessionId = existing?.resolved_id || existing?.id;
  if (sessionId) {
    return sessionId;
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
  pending: boolean;
}

function botNameFromGatewayEvent(event: GatewayEvent): string {
  const profile = (event.profile || "").trim();
  return profile || "default";
}

export function useMobileHubActivity(gateway: GatewayClient | null) {
  const [busyBots, setBusyBots] = useState<Record<string, boolean>>({});
  const [activityLabels, setActivityLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!gateway || gateway.connectionState !== "open") {
      setBusyBots({});
      setActivityLabels({});
      return;
    }

    const markBusy = (bot: string) => {
      setBusyBots((prev) => (prev[bot] ? prev : { ...prev, [bot]: true }));
    };

    const markIdle = (bot: string) => {
      setBusyBots((prev) => {
        if (!prev[bot]) return prev;
        const next = { ...prev };
        delete next[bot];
        return next;
      });
    };

    const pushLabel = (bot: string, type: string, event: GatewayEvent) => {
      const label = activityLabelForGatewayEvent(type, event.payload);
      if (!label) return;
      setActivityLabels((prev) => (prev[bot] === label ? prev : { ...prev, [bot]: label }));
    };

    const unsubs = [
      gateway.on("message.start", (event) => {
        markBusy(botNameFromGatewayEvent(event));
      }),
      gateway.on("message.complete", (event) => {
        markIdle(botNameFromGatewayEvent(event));
      }),
      gateway.on("thinking.delta", (event) => {
        const bot = botNameFromGatewayEvent(event);
        markBusy(bot);
        pushLabel(bot, "thinking.delta", event);
      }),
      gateway.on("tool.generating", (event) => {
        const bot = botNameFromGatewayEvent(event);
        markBusy(bot);
        pushLabel(bot, "tool.generating", event);
      }),
      gateway.on("tool.start", (event) => {
        const bot = botNameFromGatewayEvent(event);
        markBusy(bot);
        pushLabel(bot, "tool.start", event);
      }),
      gateway.on("tool.progress", (event) => {
        pushLabel(botNameFromGatewayEvent(event), "tool.progress", event);
      }),
      gateway.on("tool.complete", (event) => {
        pushLabel(botNameFromGatewayEvent(event), "tool.complete", event);
      }),
      gateway.on("status.update", (event) => {
        pushLabel(botNameFromGatewayEvent(event), "status.update", event);
      }),
      gateway.on("message.interim", (event) => {
        const bot = botNameFromGatewayEvent(event);
        markBusy(bot);
        pushLabel(bot, "message.interim", event);
      }),
      gateway.on("review.summary", (event) => {
        pushLabel(botNameFromGatewayEvent(event), "review.summary", event);
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
      setBusyBots({});
      setActivityLabels({});
    };
  }, [gateway]);

  return { busyBots, activityLabels };
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
      const pending = isPendingActivityType(type);
      setActivities((prev) => [
        ...prev.slice(-12),
        { id: `${type}-${Date.now()}-${prev.length}`, label, at: Date.now(), pending },
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
      gateway.on("review.summary", (event) => {
        if (!matches(event)) return;
        pushActivity("review.summary", event);
      }),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
      setBusy(false);
      setActivities([]);
    };
  }, [gateway, profileName, sessionId]);

  const latestActivityLabel = activities.length > 0 ? activities[activities.length - 1]?.label ?? null : null;

  return { busy, activities, latestActivityLabel };
}
