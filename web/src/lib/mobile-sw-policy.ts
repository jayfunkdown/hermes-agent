/** Shared mobile service-worker cache policy (kept in sync with `web/public/sw.js`). */

export const MOBILE_SW_CACHE_PREFIX = "hermes-mobile-shell-";

/** Build-time placeholder stamped into `web/public/sw.js` by Vite. */
export const MOBILE_SW_BUILD_PLACEHOLDER = "__HERMES_MOBILE_SW_BUILD__";

export function mobileSwCacheName(buildId: string): string {
  const id = (buildId || "dev").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${MOBILE_SW_CACHE_PREFIX}${id}`;
}

/** API traffic must never be answered from the mobile shell cache. */
export function shouldBypassServiceWorkerCache(pathname: string): boolean {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return path === "/api" || path.startsWith("/api/");
}

/** Drop every previous hermes-mobile-shell-* cache except the active build. */
export function shouldDeleteOldMobileShellCache(cacheName: string, currentCacheName: string): boolean {
  return cacheName.startsWith(MOBILE_SW_CACHE_PREFIX) && cacheName !== currentCacheName;
}

export function isMobileShellNavigationPath(pathname: string): boolean {
  const path = (pathname.replace(/\/+$/, "") || "/") as string;
  return (
    path === "/mobile" ||
    path.endsWith("/mobile") ||
    path === "/login" ||
    path.endsWith("/login") ||
    path === "/" ||
    path.endsWith("/index.html")
  );
}
