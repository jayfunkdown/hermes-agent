/**
 * Detect a waiting/activated mobile service worker and reload once so phones
 * pick up the new shell without manually clearing site storage.
 */

const RELOAD_GUARD_KEY = "hermes-mobile-sw-reload";

function alreadyReloadedFor(scriptURL: string): boolean {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) === scriptURL;
  } catch {
    return false;
  }
}

function markReloaded(scriptURL: string): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, scriptURL);
  } catch {
    /* private mode — still attempt a single reload */
  }
}

function reloadOnce(scriptURL: string): void {
  if (alreadyReloadedFor(scriptURL)) return;
  markReloaded(scriptURL);
  window.location.reload();
}

export function registerMobileServiceWorker(swUrl: string): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register(swUrl);

        const promptWaiting = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.postMessage({ type: "SKIP_WAITING" });
        };

        if (registration.waiting) {
          promptWaiting(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptWaiting(installing);
            }
          });
        });

        // Periodic update checks while the mobile tab stays open.
        window.setInterval(() => {
          void registration.update();
        }, 60_000);

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          const scriptURL = registration.active?.scriptURL || swUrl;
          reloadOnce(scriptURL);
        });
      } catch {
        /* registration is best-effort */
      }
    })();
  });
}
