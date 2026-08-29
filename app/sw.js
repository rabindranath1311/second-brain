// Task 8.2 / 8.6. Offline is mandatory: the data is local, so the app must work
// with no network at all.
//
// Two things update, and they are not the same thing:
//
//   * `?v=NN` in index.html versions the *assets*. The fetch handler matches
//     exactly, so a bump genuinely re-fetches. This is the one CLAUDE.md tells
//     you to bump when shipping JS or CSS.
//   * CACHE_VERSION versions the *cache itself*. `activate` deletes every cache
//     that is not the current one, so caches.keys() is always exactly 1 and no
//     deploy leaves orphans. Bump it when this file changes.
const CACHE_VERSION = "v225";
const CACHE = `canon-vault-${CACHE_VERSION}`;

const SHELL = [
  ".", "index.html", "styles.css", "boot.js", "app.js",
  "manifest.json",
  "vendor/fonts.css",
  "vendor/fonts/inter-normal-latin.woff2",
  "vendor/fonts/inter-normal-latin-ext.woff2",
  "vendor/fonts/inter-italic-latin.woff2",
  "vendor/fonts/inter-italic-latin-ext.woff2",
  "vendor/fonts/jetbrains-mono-normal-latin.woff2",
  "vendor/fonts/jetbrains-mono-normal-latin-ext.woff2",
  // Everything bridge.js reaches through static imports loads on every boot,
  // so ALL of it belongs in the shell — clip.js (imported by data.js) and
  // brain-text.js (imported by scaffold.js) were missing, and a stale worker
  // with no cached copy blanked the whole app. dhash.js is gone the other
  // way: nothing shipped imports it, only tests do.
  "vault/mdfile.js", "vault/vault.js", "vault/dashboard.js",
  "vault/data.js", "vault/bridge.js", "vault/links.js",
  "vault/images.js", "vault/scaffold.js",
  "vault/clip.js", "vault/brain-text.js",
  "vault/excalidraw.js", "vault/inspo.js", "vendor/lz-string.js",
  "vendor/markdown-it.min.js",
  // vendor/excalidraw/* is deliberately NOT precached: it is ~8MB, and a vault
  // with no drawings must not pay for it. The fetch handler caches it on first
  // use, so it is offline-available from the moment a drawing is opened once.
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png",
  "icons/favicon.svg", "icons/mark.svg", "icons/wordmark.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Individually, so one 404 cannot fail the whole install.
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // The document is special: it is the file that carries every `?v=`, so a
  // cached copy pins the app to the build that shipped with it. Serving it
  // cache-first meant a returning user could never receive an update at all,
  // no matter how many versions were bumped.
  const isDoc = e.request.mode === "navigate"
    || url.pathname === "/" || url.pathname.endsWith("/")
    || url.pathname.endsWith(".html");

  /* The data layer is network-first for the same reason the document is:
     it carries no `?v=`.

     boot.js reads its own `?v=NN` and passes it to bridge.js, and bridge.js
     passes it on to app.js and demo-vault.js. But bridge.js's own STATIC
     imports — vault.js, data.js, links.js, mdfile.js, scaffold.js,
     excalidraw.js, inspo.js — are bare `./x.js` specifiers. A static import
     cannot interpolate a variable, and there is no build step to rewrite
     them, so those seven files are requested at a constant URL forever.
     Cache-first on a constant URL means a returning user keeps last deploy's
     data layer no matter how many versions are bumped — the bug that hides
     best, because the UI updates and the logic under it does not.

     They are a few KB each. Correctness is worth the round trip, and the
     cache still answers when the network is gone. */
  const isDataLayer = url.pathname.startsWith("/vault/") && url.pathname.endsWith(".js");

  e.respondWith((async () => {
    const save = async (res) => {
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    };

    if (isDoc || isDataLayer) {
      try { return await save(await fetch(e.request)); }         // network-first
      catch {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        // Falling back to index.html is right for a navigation and wrong for
        // a module — an HTML body served as JS is a syntax error, and the
        // whole app fails to boot rather than degrading.
        return isDoc ? (await caches.match("index.html")) || Response.error()
                     : Response.error();
      }
    }

    // Assets are versioned, so an exact match is the correct hit. Matching with
    // ignoreSearch up front made the cache-bust a no-op: `boot.js?v=73` hit the
    // precached `boot.js` from the previous deploy.
    const exact = await caches.match(e.request);
    if (exact) return exact;
    try { return await save(await fetch(e.request)); }
    catch {
      // Offline. Now ignoring the query is right, not wrong: the precached
      // shell is stored unversioned, and stale beats a broken page.
      return (await caches.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});

self.addEventListener("message", (e) => {
  if (e.data === "version") e.source.postMessage({ version: CACHE_VERSION, cache: CACHE });
});
