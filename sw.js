// Service worker : permet l'installation et l'ouverture hors connexion.
// Stratégie « réseau d'abord » : on prend toujours la version la plus
// récente, et on retombe sur le cache si pas de réseau.
const CACHE = "fk-agenda-v48";
const FICHIERS = [
  "./", "./index.html", "./config.js", "./manifest.json",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./logo.png", "./nuit-magique.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // fichiers de l'app + bibliothèques/polices externes : copie gardée pour le hors-ligne
  const externe = /(^|\.)(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (e.request.method !== "GET" || (url.origin !== self.location.origin && !externe)) return;
  if (/tesseract|pdf\.worker|pdfjs|traineddata/i.test(url.href)) return;   // gros fichiers de lecture de tickets : pas en cache
  e.respondWith(
    fetch(e.request)
      .then((rep) => {
        const copie = rep.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
        return rep;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

// ---------- Notifications ----------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: "Fantasy Kids Events", body: e.data ? e.data.text() : "" }; }
  const son = String(d.tag || "").startsWith("chat-") ? "message" : "notif";
  e.waitUntil((async () => {
    // app ouverte et visible : on joue le son magique dedans
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ son }));
    await self.registration.showNotification(d.title || "Fantasy Kids Events", {
      body: d.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: d.tag,
      renotify: !!d.tag,
      vibrate: son === "message" ? [60, 40, 60] : [80, 50, 80, 50, 220],   // vibration « Fantasy » (Android)
      data: { url: d.url || "./" },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope);
  const ev = url.searchParams.get("ev");
  const signal = url.searchParams.get("signal") === "1";
  const chat = url.searchParams.get("chat");
  const costumes = url.searchParams.get("costumes") === "1";
  const checklist = url.searchParams.get("checklist") === "1";
  const vue = url.searchParams.get("vue");
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        if (ev || chat || costumes || checklist || vue) w.postMessage({ ev, signal, chat, costumes, checklist, vue });
        return;
      }
    }
    return self.clients.openWindow(url.href);
  })());
});
