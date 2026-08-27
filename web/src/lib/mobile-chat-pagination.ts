/** Mobile Bot Chat transcript paging — keep initial render bounded. */

export const MOBILE_CHAT_PAGE_SIZE = 50;

export function hasMoreEarlierMessages(
  returned: number,
  limit: number = MOBILE_CHAT_PAGE_SIZE,
): boolean {
  return returned >= limit;
}

export function nextEarlierOffset(currentOffset: number, returned: number): number {
  return currentOffset + Math.max(0, returned);
}

export function buildMobileSessionMessagesQuery(
  options: { limit?: number; offset?: number } = {},
): string {
  const limit = options.limit ?? MOBILE_CHAT_PAGE_SIZE;
  const offset = options.offset ?? 0;
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    order: "latest",
  });
  return query.toString();
}
