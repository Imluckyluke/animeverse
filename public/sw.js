/* AnimeVerse PWA shell.
 *
 * Navigations stay network-first so a catalog rebuild is picked up quickly.
 * Static assets are served cache-first with a background refresh. API routes,
 * admin pages and Telegram links are never cached.
 *
 * Updates are never applied behind the reader's back: this worker waits, and
 * the page tells it to take over (see pwa-provider.tsx) once the reader has
 * been told a new version is ready.
 */
const VERSION = "v6-local-media";
const CACHE = `animeverse-shell-${VERSION}`;
const OFFLINE_URL = "/offline";
const SHELL = ["/", "/browse", OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png"];
const PRIVATE_PATH = /^\/(?:api|admin|account|login|favorites|media)(?:\/|$)/;
async function storePublic(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - 250)).map(key => cache.delete(key)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('animeverse-shell-') && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "SKIP_WAITING" || (data && data.type === "SKIP_WAITING")) {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PRIVATE_PATH.test(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            storePublic(request, copy).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return caches.match("/") || Response.error();
        }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/covers/") || url.pathname.startsWith("/banners/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              storePublic(request, copy).catch(() => undefined);
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
