import { useCallback, useEffect, useRef, useState } from "react";

import type { GatewayClient } from "@/lib/gatewayClient";
import type { GatewayEvent } from "@hermes/shared";
import {
  activityLabelForGatewayEvent,
  BOT_ROSTER_POLL_MS,
  CANONICAL_CHAT_TITLE,
  isBotHidden,
  sortBotsForHub,
  type MobileBotRow,
  type ProfilesListResult,
} from "@/lib/mobile-bot-roster";

export function useMobileBotRoster(gateway: GatewayClient | null) {
  const [bots, setBots] = useState<MobileBotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const avatarFetchedRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!gateway || gateway.connectionState !== "open") {
      return;
    }
    setError(null);
    try {
      const result = await gateway.request<ProfilesListResult>("profiles.list", {});
      const visible = sortBotsForHub((result.profiles ?? []).filter((bot) => !isBotHidden(bot)));
      setBots(visible);

      for (const bot of visible) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [gateway]);

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
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gateway, refresh]);

  return { bots, loading, error, avatars, refresh };
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
