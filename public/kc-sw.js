/*
 * Knowledge Capture offline service worker (registered by /knowledge-capture).
 *
 * Makes the capture page open with no signal, so a take can be recorded
 * anywhere; the page itself keeps takes on the device (lib/knowledge-capture/
 * outbox.ts) and uploads them when signal returns. This worker only caches:
 *   - the page HTML (network first; falls back to the last good copy when
 *     offline, on weak signal, or when the session has expired),
 *   - the hashed /_next/static files that page needs (cache first),
 *   - the last good owner/property list and profiles (network first).
 * Everything else, including every other page, goes straight to the network.
 */

const VERSION = "v1";
const SHELL = `kc-shell-${VERSION}`; // page HTML, manifest, icons, asset list
const STATIC = "kc-static"; // /_next/static files — content-hashed, never change
const DATA = "kc-data"; // last good API responses for the page

const PAGE = "/knowledge-capture";
const OVERVIEW = "/api/knowledge-capture"; // the owner/property list
const SHELL_FILES = ["/kc.webmanifest", "/kc-icon-180.png", "/kc-icon-192.png", "/kc-icon-512.png"];
const ASSET_LIST = "/__kc-assets"; // JSON list of static files the cached page references
const PAGE_WAIT_MS = 4000; // weak signal: show the saved page rather than a blank screen
const DATA_WAIT_MS = 10000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(SHELL_FILES).catch(() => undefined);
      // Signed-in installs get the page now; otherwise the first visit saves it.
      const res = await fetch(PAGE, { credentials: "same-origin" }).catch(() => null);
      if (res && res.ok && !res.redirected) await savePage(res).catch(() => undefined);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("kc-shell-") && n !== SHELL).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// The page sends the static files it loaded before this worker took control.
// Its first owner/property list also loaded before then, so fetch one now:
// without it, someone who installs and then loses signal can't pick an owner.
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "kc-cache" || !Array.isArray(msg.urls)) return;
  event.waitUntil(
    Promise.all([
      cacheStatic(msg.urls.filter(isStaticUrl)),
      caches.match(OVERVIEW, { cacheName: DATA }).then((hit) =>
        hit ? undefined : fetch(OVERVIEW, { credentials: "same-origin" }).then((res) => saveData(OVERVIEW, res))
      ),
    ]).catch(() => undefined)
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Other pages (and sign-in redirects) load exactly as they would without this worker.
  if (req.mode === "navigate") {
    if (url.pathname === PAGE) event.respondWith(pageRequest(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticRequest(event));
    return;
  }
  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname, { cacheName: SHELL }).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.pathname === OVERVIEW || url.pathname.startsWith(`${OVERVIEW}/subjects/`)) {
    event.respondWith(dataRequest(event, url));
  }
});

/** Resolves with `promise`, or rejects after `ms`. */
function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

const goodPage = (res) => res.ok && res.type === "basic" && !res.redirected;

async function pageRequest(event) {
  const network = fetch(event.request);
  // Keep the saved copy current whenever the real page comes back.
  event.waitUntil(network.then((res) => (goodPage(res) ? savePage(res.clone()) : undefined)).catch(() => undefined));

  const cached = await caches.match(PAGE, { cacheName: SHELL });
  if (!cached) return network.catch(() => offlinePage());
  try {
    const res = await within(network, PAGE_WAIT_MS);
    // A redirect here is the sign-in gate (8-hour sessions). Recording must
    // still work, so open the saved page; it asks for sign-in to upload.
    return goodPage(res) ? res : cached;
  } catch {
    return cached;
  }
}

/** Save the page and the static files it references; drop the previous build's files. */
async function savePage(res) {
  const shell = await caches.open(SHELL);
  const html = await res.clone().text();
  await shell.put(PAGE, res);
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s\\)<>]+/g) || [])];
  await cacheStatic(assets);

  const previous = await shell.match(ASSET_LIST).then((r) => (r ? r.json() : [])).catch(() => []);
  const keep = new Set(assets);
  const stale = previous.filter((u) => !keep.has(u));
  if (stale.length) {
    const statics = await caches.open(STATIC);
    await Promise.all(stale.map((u) => statics.delete(u)));
  }
  await shell.put(ASSET_LIST, new Response(JSON.stringify(assets), { headers: { "Content-Type": "application/json" } }));
}

function isStaticUrl(u) {
  try {
    const url = new URL(u, self.location.origin);
    return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
  } catch {
    return false;
  }
}

async function cacheStatic(urls) {
  const statics = await caches.open(STATIC);
  await Promise.all(
    urls.map(async (u) => {
      if (await statics.match(u)) return;
      const res = await fetch(u).catch(() => null);
      if (res && res.ok) await statics.put(u, res);
    })
  );
}

async function staticRequest(event) {
  const req = event.request;
  const hit = await caches.match(req, { cacheName: STATIC });
  if (hit) return hit;
  const res = await fetch(req);
  // Only remember files the capture page loads, so browsing the rest of the
  // app doesn't fill the phone with every page's code.
  if (res.ok && (await fromCapturePage(event))) {
    const copy = res.clone();
    event.waitUntil(caches.open(STATIC).then((c) => c.put(req, copy)));
  }
  return res;
}

async function fromCapturePage(event) {
  if (!event.clientId) return false;
  const client = await self.clients.get(event.clientId);
  return !!client && new URL(client.url).pathname === PAGE;
}

async function dataRequest(event, url) {
  // The overview is one entry whatever its query (?refresh=1); profiles by path.
  const key = url.pathname;
  const network = fetch(event.request);
  event.waitUntil(network.then((res) => saveData(key, res.clone())).catch(() => undefined));

  const cached = await caches.match(key, { cacheName: DATA });
  if (!cached) return network;
  try {
    const res = await within(network, DATA_WAIT_MS);
    // Signed out or a server hiccup: the saved list still lets someone record.
    return res.ok ? res : offlineCopy(cached);
  } catch {
    return offlineCopy(cached);
  }
}

async function saveData(key, res) {
  if (!res.ok || res.redirected) return;
  const saved = new Response(await res.blob(), {
    headers: { "Content-Type": "application/json", "X-KC-Saved-At": new Date().toISOString() },
  });
  await (await caches.open(DATA)).put(key, saved);
}

async function offlineCopy(cached) {
  return new Response(await cached.blob(), {
    headers: {
      "Content-Type": "application/json",
      "X-KC-Offline": "1",
      "X-KC-Saved-At": cached.headers.get("X-KC-Saved-At") || "",
    },
  });
}

function offlinePage() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · HDPM OS</title>
<body style="font-family:system-ui,sans-serif;padding:32px 16px;color:#2d2a33;max-width:32rem;margin:auto">
<h1 style="font-size:20px">You're offline</h1>
<p>Knowledge Capture isn't saved on this device yet. Open it once while you have signal and are signed in; after that it opens and records with no signal.</p>
<p><a href="${PAGE}" style="color:#b4532a;font-weight:600">Try again</a></p>
</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
