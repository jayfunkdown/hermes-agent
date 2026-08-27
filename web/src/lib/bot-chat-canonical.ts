/** Shared Bot Chat identity contract (desktop plugin + mobile hub). */

export const CANONICAL_BOT_CHAT_TITLE = "Bot Chat";

export function canonicalSessionListParams(profileName: string): Record<string, unknown> {
  const profile = profileName.trim();
  return {
    ...(profile && profile !== "default" ? { profile } : {}),
    title: CANONICAL_BOT_CHAT_TITLE,
    include_hidden: true,
  };
}

export function canonicalSessionCreateParams(profileName: string): Record<string, unknown> {
  return {
    ...canonicalSessionListParams(profileName),
    hidden: true,
  };
}
