/* The worker caches only the public offline page. Auth/API/document responses
 * always use the network and are never copied into a service-worker cache. */
const OFFLINE_CACHE = "kova-public-offline-v1",
  DB_NAME = "kova-pwa-v1";
let serial = Promise.resolve();
const queued = (fn) => {
  const next = serial.then(fn, fn);
  serial = next.catch(() => {});
  return next;
};
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("meta");
      request.result.createObjectStore("shares", { keyPath: "ticket" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("storage unavailable"));
  });
}
async function transaction(store, mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode),
        request = action(tx.objectStore(store));
      let value;
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(Error("storage unavailable"));
      tx.onabort = () => reject(Error("storage unavailable"));
    });
  } finally {
    db.close();
  }
}
const get = (key) => transaction("meta", "readonly", (s) => s.get(key));
const set = (key, value) => transaction("meta", "readwrite", (s) => s.put(value, key));
const setOwner = (ownerId, epoch) =>
  transaction("meta", "readwrite", (s) => {
    s.put(ownerId, "owner");
    return s.put(epoch, "epoch");
  });
async function revokeRemote(binding) {
  try {
    const response = await fetch("/api/push/revoke-device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: binding.id, deviceSecret: binding.deviceSecret }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
async function flushRevokes() {
  const pending = (await get("revokes")) ?? [],
    remaining = [];
  for (const value of pending.slice(0, 1)) if (!(await revokeRemote(value))) remaining.push(value);
  remaining.push(...pending.slice(1, 5));
  await set("revokes", remaining);
}
async function clearBinding() {
  const binding = await get("binding");
  await set("binding", null);
  await set("delivered", []);
  if (binding) {
    const pending = (await get("revokes")) ?? [];
    await set(
      "revokes",
      [
        ...pending.filter((v) => v.id !== binding.id),
        { id: binding.id, deviceSecret: binding.deviceSecret },
      ].slice(-5),
    );
  }
  let timer;
  try {
    await Promise.race([
      self.registration.pushManager.getSubscription().then((value) => value?.unsubscribe()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("unsubscribe timeout")), 2000);
      }),
    ]);
  } catch {
    /* The cleared local binding suppresses an in-flight push too. */
  } finally {
    clearTimeout(timer);
  }
  await flushRevokes();
}
async function clearShares(owner) {
  const rows = await transaction("shares", "readonly", (s) => s.getAll());
  for (const row of rows)
    if (
      row.expiresAt <= Date.now() ||
      (owner !== "__expired__" && (!row.ownerId || row.ownerId === owner))
    )
      await transaction("shares", "readwrite", (s) => s.delete(row.ticket));
}
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("empty");
  const chunks = [];
  let length = 0,
    timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 64000) throw Error("too large");
      chunks.push(value);
    }
    if (timedOut) throw Error("share timed out");
    const result = new Uint8Array(length);
    let offset = 0;
    for (const value of chunks) {
      result.set(value, offset);
      offset += value.length;
    }
    return result;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
async function receiveShare(request) {
  try {
    const body = await readBody(request),
      form = await new Response(body, {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      }).formData();
    if (
      [...form.keys()].some((key) => !["title", "text", "url"].includes(key)) ||
      ["title", "text", "url"].some((key) => form.getAll(key).length > 1)
    )
      throw Error("unsupported");
    const value = {};
    for (const [key, max] of [
      ["title", 512],
      ["text", 12000],
      ["url", 2048],
    ]) {
      const field = form.get(key) ?? "";
      if (typeof field !== "string" || field.length > max) throw Error("unsupported");
      value[key] = field;
    }
    if (value.url) {
      const target = new URL(value.url);
      if (!["https:", "http:"].includes(target.protocol) || target.username || target.password)
        throw Error("unsupported");
    }
    if (!`${value.title}${value.text}${value.url}`.trim()) throw Error("empty");
    const ownerId = await get("owner"),
      ticket = crypto.randomUUID();
    await clearShares("__expired__");
    const existing = await transaction("shares", "readonly", (s) => s.getAll());
    if (existing.length >= 5) throw Error("full");
    await transaction("shares", "readwrite", (s) =>
      s.put({ ticket, ownerId, value, expiresAt: Date.now() + 300000 }),
    );
    return Response.redirect(`${self.location.origin}/share-inbox?ticket=${ticket}`, 303);
  } catch {
    return new Response(
      "This share could not be received. Open KovaGPT and paste the text yourself.",
      { status: 400, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } },
    );
  }
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add("/offline.html"))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    queued(async () => {
      for (const key of await caches.keys())
        if (key.startsWith("kova-public-offline-") && key !== OFFLINE_CACHE)
          await caches.delete(key);
      await clearShares("__expired__");
      await flushRevokes();
      await self.clients.claim();
    }),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/share-inbox" && event.request.method === "POST") {
    event.respondWith(queued(() => receiveShare(event.request)));
    return;
  }
  if (event.request.mode === "navigate" && event.request.method === "GET")
    event.respondWith(
      fetch(event.request).catch(
        async () =>
          (await caches.match("/offline.html")) ??
          new Response("You are offline. Connect to open KovaGPT.", { status: 503 }),
      ),
    );
});
self.addEventListener("message", (event) => {
  const port = event.ports?.[0];
  if (!port) return;
  event.waitUntil(
    queued(async () => {
      try {
        const client = await self.clients.get(event.source?.id);
        if (!client || new URL(client.url).origin !== self.location.origin)
          throw Error("invalid client");
        const data = event.data,
          owner = await get("owner"),
          epoch = (await get("epoch")) ?? 0;
        if (data?.type === "STATE") {
          port.postMessage({ ok: true, ownerId: owner ?? null, epoch });
          return;
        }
        if (data?.type === "OWNER") {
          if (data.ownerId !== null && !/^[a-f0-9-]{36}$/iu.test(data.ownerId ?? ""))
            throw Error("invalid owner");
          if (data.expectedEpoch !== epoch) throw Error("owner epoch changed");
          if (owner !== data.ownerId) {
            await clearBinding();
            if (owner || data.ownerId === null) await clearShares(owner);
            await setOwner(data.ownerId, epoch + 1);
          }
          if (owner === data.ownerId) await flushRevokes();
          port.postMessage({ ok: true, epoch: owner !== data.ownerId ? epoch + 1 : epoch });
          return;
        }
        if (data?.type === "CLEAR_OWNER") {
          if (data.ownerId !== null && !/^[a-f0-9-]{36}$/iu.test(data.ownerId ?? ""))
            throw Error("invalid owner");
          const binding = await get("binding");
          if (binding?.ownerId === data.ownerId) await clearBinding();
          await clearShares(data.ownerId);
          if (owner === data.ownerId) {
            await setOwner(null, epoch + 1);
          }
          port.postMessage({ ok: true });
          return;
        }
        if (!owner || data?.ownerId !== owner || data.expectedEpoch !== epoch)
          throw Error("account changed");
        if (data.type === "BINDING") {
          port.postMessage({ ok: true, binding: await get("binding") });
          return;
        }
        if (data.type === "UNSUBSCRIBE") {
          await clearBinding();
          port.postMessage({ ok: true });
          return;
        }
        if (data.type === "BIND") {
          const b = data.binding;
          if (
            b?.ownerId !== owner ||
            !/^[a-f0-9-]{36}$/iu.test(b.id ?? "") ||
            !/^[A-Za-z0-9_-]{43}$/u.test(b.deviceSecret ?? "") ||
            !Number.isSafeInteger(b.revision)
          )
            throw Error("invalid binding");
          await set("binding", b);
          port.postMessage({ ok: true });
          return;
        }
        if (data.type === "SHARE" || data.type === "SHARE_CONSUME") {
          if (
            new URL(client.url).pathname !== "/share-inbox" ||
            !/^[a-f0-9-]{36}$/iu.test(data.ticket ?? "")
          )
            throw Error("invalid ticket");
          const row = await transaction("shares", "readonly", (s) => s.get(data.ticket));
          if (!row) throw Error("share unavailable");
          if (row.expiresAt <= Date.now() || (row.ownerId && row.ownerId !== owner)) {
            await transaction("shares", "readwrite", (s) => s.delete(data.ticket));
            throw Error("share unavailable");
          }
          if (data.type === "SHARE_CONSUME") {
            await transaction("shares", "readwrite", (s) => s.delete(data.ticket));
            port.postMessage({ ok: true });
            return;
          }
          if (!row.ownerId)
            await transaction("shares", "readwrite", (s) => s.put({ ...row, ownerId: owner }));
          port.postMessage({ ok: true, value: row.value });
          return;
        }
        throw Error("unsupported");
      } catch {
        port.postMessage({ ok: false });
      }
    }),
  );
});
self.addEventListener("push", (event) =>
  event.waitUntil(
    queued(async () => {
      try {
        const payload = event.data?.json(),
          binding = await get("binding"),
          owner = await get("owner");
        if (
          payload?.version !== 1 ||
          !binding ||
          binding.ownerId !== owner ||
          payload.subscriptionId !== binding.id ||
          !["application", "agent"].includes(payload.eventSource) ||
          !/^[a-f0-9-]{36}$/iu.test(payload.eventId ?? "") ||
          !Number.isFinite(Date.parse(payload.eventAt)) ||
          Date.parse(payload.eventAt) > Date.now() + 30000 ||
          Date.parse(payload.eventAt) <= Date.now() - 86400000
        )
          return;
        const key = `${binding.id}:${payload.eventSource}:${payload.eventId}`;
        const delivered = ((await get("delivered")) ?? []).filter(
          (row) => row.expiresAt > Date.now(),
        );
        if (delivered.some((row) => row.key === key) || delivered.length >= 2048) return;
        // Persist before showing: a lost server settlement cannot notify again
        // after dismissal. At capacity, fail closed until old receipts expire.
        delivered.push({ key, expiresAt: Date.parse(payload.eventAt) + 86400000 });
        await set("delivered", delivered);
        await self.registration.showNotification("KovaGPT", {
          body: "You have a new update. Open KovaGPT to view it.",
          icon: "/favicon.png",
          badge: "/favicon.png",
          tag: "kova-update",
          data: { subscriptionId: binding.id },
          renotify: false,
        });
      } catch {
        /* Malformed payloads never expose notification content. */
      }
    }),
  ),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    queued(async () => {
      const binding = await get("binding");
      if (!binding || binding.id !== event.notification.data?.subscriptionId) return;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows)
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate("/notifications");
          await client.focus();
          return;
        }
      await self.clients.openWindow("/notifications");
    }),
  );
});
self.addEventListener("pushsubscriptionchange", (event) =>
  event.waitUntil(queued(() => clearBinding())),
);
