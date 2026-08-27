/* Hermes mobile PWA shell.
 *
 * CACHE_NAME is stamped at build time (see vite hermesMobileSwBuildId plugin).
 * Every deploy produces a new cache id so phones drop the previous shell.
 */
const CACHE_NAME = "hermes-mobile-shell-__HERMES_MOBILE_SW_BUILD__";
const CACHE_PREFIX = "hermes-mobile-shell-";
const PRECACHE_URLS = ["./mobile", "./manifest.webmanifest"];

function shouldBypassCache(url) {
  // Never cache API traffic — live roster/session data must hit the network.
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function isShellNavigation(request, url) {
  if (request.mode !== "navigate") return false;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/mobile" ||
    path.endsWith("/mobile") ||
    path === "/login" ||
    path.endsWith("/login") ||
    path === "/" ||
    path.endsWith("/index.html")
  );
}

function isHashedAsset(url) {
  return url.pathname.includes("/assets/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch {
        // Offline install is best effort; network-first navigations still work online.
      }
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (shouldBypassCache(url)) return;

  // App shell + login: network-first so a deploy's new hashed assets are discovered quickly.
  if (isShellNavigation(request, url)) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            void cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? (await caches.match("./mobile")) ?? Response.error();
        }),
    );
    return;
  }

  // Hashed Vite assets: network-first with cache fallback (never stick on a stale shell chunk).
  if (isHashedAsset(url) || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            void cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? Response.error()),
    );
    return;
  }

  // Other same-origin GETs (icons, manifest): stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            void cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);
      if (cached) {
        void networkPromise;
        return cached;
      }
      return (await networkPromise) ?? Response.error();
    }),
  );
});
