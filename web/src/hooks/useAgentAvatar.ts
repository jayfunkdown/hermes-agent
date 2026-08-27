import { useEffect, useState } from "react";

import type { GatewayClient } from "@/lib/gatewayClient";
import {
  botAppearance,
  botRosterMeta,
  type MobileBotRow,
} from "@/lib/mobile-bot-roster";

const avatarCache = new Map<string, string | null>();
const avatarMissAt = new Map<string, number>();
const avatarInflight = new Map<string, Promise<string | null>>();
const AVATAR_MISS_TTL_MS = 30_000;

function profileNameForHandle(handle: string): string {
  const key = handle.trim().toLowerCase();
  if (!key || key === "hermes") return "default";
  return key;
}

export function findBotForHandle(bots: MobileBotRow[], handle: string): MobileBotRow | null {
  const key = handle.trim().toLowerCase();
  if (!key) return null;
  return (
    bots.find((bot) => bot.name.toLowerCase() === key) ??
    (key === "hermes" ? bots.find((bot) => bot.name === "default") ?? null : null)
  );
}

async function fetchAvatarFromGateway(gateway: GatewayClient, handle: string): Promise<string | null> {
  const key = handle.trim().toLowerCase();
  if (!key) return null;

  if (avatarCache.has(key)) {
    const hit = avatarCache.get(key) ?? null;
    if (hit !== null) return hit;
    if (Date.now() - (avatarMissAt.get(key) ?? 0) < AVATAR_MISS_TTL_MS) {
      return null;
    }
    avatarCache.delete(key);
  }

  const inflight = avatarInflight.get(key);
  if (inflight) return inflight;

  const run = (async () => {
    try {
      if (gateway.connectionState !== "open") {
        await gateway.connect();
      }
      const listed = await gateway.request<{ profiles?: Array<{ has_avatar?: boolean; name: string }> }>(
        "profiles.list",
        { include_sessions: false },
      );
      const profiles = listed.profiles ?? [];
      let profile = profiles.find((row) => row.name.toLowerCase() === key);
      if (!profile && key === "hermes") {
        profile = profiles.find((row) => row.name === "default");
      }
      if (!profile?.has_avatar) return null;

      const asset = await gateway.request<{ data?: string; found?: boolean }>("profiles.get_asset", {
        asset: "avatar",
        name: profile.name,
      });
      return asset?.found && asset.data ? asset.data : null;
    } catch {
      return null;
    } finally {
      avatarInflight.delete(key);
    }
  })();

  avatarInflight.set(key, run);
  const url = await run;
  avatarCache.set(key, url);
  if (url === null) {
    avatarMissAt.set(key, Date.now());
  }
  return url;
}

export function useAgentAvatar(
  handle: string,
  gateway: GatewayClient | null,
  options: { rosterAvatars?: Record<string, string>; bots?: MobileBotRow[] } = {},
) {
  const bot = findBotForHandle(options.bots ?? [], handle);
  const profileName = bot?.name ?? profileNameForHandle(handle);
  const rosterImage = options.rosterAvatars?.[profileName] ?? null;
  const meta = bot ? botRosterMeta(bot) : {};
  const appearance = bot ? botAppearance(bot.name, meta) : null;

  const [fetchedImage, setFetchedImage] = useState<string | null>(() => {
    const key = handle.trim().toLowerCase();
    return avatarCache.get(key) ?? rosterImage;
  });

  useEffect(() => {
    const key = handle.trim().toLowerCase();
    if (!key) return;

    if (rosterImage) {
      setFetchedImage(rosterImage);
      avatarCache.set(key, rosterImage);
      return;
    }

    const cached = avatarCache.get(key);
    if (cached) {
      setFetchedImage(cached);
      return;
    }

    if (!gateway) return;

    let cancelled = false;
    void fetchAvatarFromGateway(gateway, key).then((url) => {
      if (!cancelled && url) {
        setFetchedImage(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gateway, handle, rosterImage]);

  return {
    image: fetchedImage,
    bot,
    appearance,
  };
}
