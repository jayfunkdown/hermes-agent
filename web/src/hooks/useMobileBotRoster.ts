import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { GatewayClient } from "@/lib/gatewayClient";
import type { GatewayEvent } from "@hermes/shared";
import {
  activityLabelForGatewayEvent,
  BOT_ROSTER_POLL_MS,
  CANONICAL_CHAT_TITLE,
  rosterDefaultOnlyWarning,
  rosterLoadIncomplete,
  splitRosterByHidden,
  type MobileBotRow,
  type ProfilesListResult,
} from "@/lib/mobile-bot-roster";

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

  const { visible: visibleBots, hidden: hiddenBots } = useMemo(
    () => splitRosterByHidden(allBots),
    [allBots],
  );

  const rosterIncomplete = useMemo(
    () => rosterLoadIncomplete(allBots, visibleBots),
    [allBots, visibleBots],
  );

  const defaultOnlyWarning = useMemo(
    () => rosterMeta.defaultOnly || rosterDefaultOnlyWarning(allBots),
    [allBots, rosterMeta.defaultOnly],
  );

  const fetchAvatars = useCallback(
    async (profiles: MobileBotRow[]) => {
      if (!gateway || gateway.connectionState !== "open") return;
      for (const bot of profiles) {
        if (!bot.has_avatar || avatarFetchedRef.current.has(bot.name)) {
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
          /* avatar fetch is best effort */
        }
      }
    },
    [gateway],
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      // Prefer authenticated REST — same list_profiles walk as desktop, works
      // even when the WS gateway is slow/unavailable, and flags default_only.
      let profiles: MobileBotRow[] = [];
      let meta = { defaultOnly: false, incomplete: false, source: "rest" as string | null };

      try {
        const rest = await api.getMobileRoster(true);
        profiles = normalizeRosterRows(rest.profiles);
        meta = {
          defaultOnly: Boolean(rest.default_only),
          incomplete: Boolean(rest.incomplete || rest.default_only),
          source: rest.source || "rest",
        };
      } catch {
        // Fall back to gateway profiles.list (desktop parity path).
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

      setAllBots(profiles);
      setRosterMeta(meta);
      await fetchAvatars(profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchAvatars, gateway]);

  useEffect(() => {
    if (!gateway) {
      // REST-only path still works without a gateway socket.
      void refresh();
      return;
    }
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
          // Still try REST even if WS connect fails.
          try {
            await refresh();
          } catch {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
          }
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
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gateway, refresh]);

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
