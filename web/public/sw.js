const CACHE_NAME = "hermes-mobile-shell-v2";
const PRECACHE_URLS = ["./mobile", "./manifest.webmanifest"];

function shouldBypassCache(url) {
  return /\/api(\/|$)/.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch {
        // Offline install is best effort; the app shell will still load once
        // the network is available and cache future navigations.
      }
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys.filter((key) => key.startsWith("hermes-mobile-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldBypassCache(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("./mobile");
        return cached ?? caches.match("./manifest.webmanifest") ?? Response.error();
      }),
    );
    return;
  }

  // Only cache static shell assets (manifest/icons). Never cache API, HTML, or JS
  // bundles — those carry auth/session state or change every deploy.
  const staticAsset =
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico");
  if (!staticAsset) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          void cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cached ?? Response.error();
      }
    }),
  );
});
