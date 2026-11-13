// Bei jeder inhaltlichen Änderung der App diese Versionsnummer erhöhen.
// Das ist der einzige verlässliche Trigger, damit Chrome ein Update erkennt.
const SW_VERSION = "v3.30.0";
const CACHE_NAME = `fast-doku-shell-${SW_VERSION}`;

const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./zip-full.min.js",
  "./core/app-core.js",
  "./core/boot.js",
  "./core/utils.js",
  "./core/date-utils.js",
  "./core/update.js",
  "./crypto/crypto-engine.js",
  "./crypto/key-management.js",
  "./storage/indexeddb.js",
  "./storage/secure-store.js",
  "./data/normalization.js",
  "./data/schema.js",
  "./security/security-log.js",
  "./security/auth.js",
  "./security/lock.js",
  "./modules/fristen.js",
  "./modules/backup.js",
  "./modules/homes.js",
  "./ui/views.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vorlagen/unterschriftenblatt.pdf"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES))
  );
  // KEIN automatisches skipWaiting() mehr. Der neue Service Worker bleibt
  // im Zustand "waiting", bis der Nutzer das Update über den Update-Button
  // in der App bestätigt (siehe core/update.js -> SKIP_WAITING Message).
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "GET_VERSION") {
    event.ports?.[0]?.postMessage({ version: SW_VERSION });
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Stale-while-revalidate: aus dem Cache sofort ausliefern, im Hintergrund
  // neu laden, damit der Cache nach einem Update zeitnah aktuell wird.
  event.respondWith((async () => {
    const cached = await caches.match(event.request);

    const networkFetch = fetch(event.request).then((response) => {
      if (response && response.ok) {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(networkFetch);
      return cached;
    }

    const networkResponse = await networkFetch;
    return networkResponse || Response.error();
  })());
});