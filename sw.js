// Combined service worker:
//  1. OneSignal's worker (handles receiving/displaying real push notifications,
//     incl. background pushes when the app is closed).
//  2. A small app-shell cache so the page still loads offline.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = "wotd-shell-v1";
const SHELL_FILES = ["./", "./index.html", "./style.css", "./script.js", "./words.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin app-shell requests; let API calls pass straight through.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// Notification click handling is managed by the imported OneSignal worker
// above (configurable via OneSignal dashboard > Web Push > Click behavior).
