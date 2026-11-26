// Offline support: the app shell is cached on install; Bible data is cached
// as you read it, so chapters you've opened work without a connection.
const VERSION = "v7";
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const SHELL_FILES = ["./", "index.html", "app.js", "refs.js", "store.js", "morph.js", "compare.js", "hebrew.js", "speech.js", "config.js", "style.css",
  "icon.svg", "manifest.webmanifest", "../books.json", "../differences.json", "../contradictions.json", "../hard-passages.json", "../history.json", "../keywords.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isData = url.pathname.includes("/data/");
  if (isData && !url.pathname.endsWith("manifest.json")) {
    // cache-first for immutable-ish data files
    e.respondWith(caches.open(DATA).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
  } else {
    // network-first for the app shell so updates arrive promptly
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) caches.open(isData ? DATA : SHELL).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request)));
  }
});
