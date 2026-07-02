const CACHE_NAME = "audio-book-shell-v11";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
];

function isCacheableShellRequest(requestUrl) {
  return (
    requestUrl.pathname.endsWith("/") ||
    SHELL_FILES.some((file) => {
      const normalized = file.replace(/^\.\//, "/");
      return normalized !== "/" && requestUrl.pathname.endsWith(normalized);
    })
  );
}

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", responseCopy));
          }

          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (!isCacheableShellRequest(requestUrl)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }

          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
          return response;
        });

      if (cached) {
        event.waitUntil(networkFetch.catch(() => undefined));
        return cached;
      }

      return networkFetch.catch(() => caches.match("./index.html"));
    })
  );
});
