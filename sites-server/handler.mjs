import {
  siteAssetRequest,
  siteHostingConfig,
  sitePath,
  siteSlug,
  sha256,
  SITE_LIMITS,
} from "../src/lib/sites-policy.mjs";
const TOKEN = /^[a-f0-9]{64}$/u;
const BOOTSTRAP = String.raw`const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);if(!/^[a-f0-9]{64}$/.test(token)){document.body.textContent='This access link expired. Open the Site again from KovaGPT.';}else{fetch('/__kova/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async r=>{const v=await r.json();if(!r.ok||!/^\/[a-z0-9-]+\/$/.test(v.path))throw Error();location.replace(v.path);}).catch(()=>{document.body.textContent='Access could not be confirmed. Open the Site again from KovaGPT.';});}`;
const CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; media-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-same-origin; worker-src 'none'";
const headers = () =>
  new Headers({
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Origin-Agent-Cluster": "?1",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": CSP,
  });
const failure = (status = 404) => new Response("Site unavailable", { status, headers: headers() });
async function rpc(admin, name, args) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10000);
  try {
    const query = admin.rpc(name, args);
    const result = await (typeof query.abortSignal === "function"
      ? query.abortSignal(controller.signal)
      : query);
    if (result.error) throw Error("site_unavailable");
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}
/** Dedicated entrypoint only: no application router, auth UI, or application
 * cookies are mounted here. Request host is derived from the actual connection
 * host, never X-Forwarded-Host. Each Site gets a different host-only cookie. */
export function createSiteAssetHandler({ admin, env = {} }) {
  const config = siteHostingConfig(env);
  return async (request) => {
    const matched = siteAssetRequest(request, config);
    if (!matched) return failure();
    const { siteId, url } = matched;
    try {
      if (url.pathname === "/__kova/access") {
        if (request.method !== "GET" || url.search) return failure();
        const h = headers();
        h.set("Content-Type", "text/html; charset=utf-8");
        const hash = await sha256(BOOTSTRAP);
        let binary = "";
        for (let i = 0; i < hash.length; i += 2)
          binary += String.fromCharCode(parseInt(hash.slice(i, i + 2), 16));
        h.set(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'sha256-${btoa(binary)}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        );
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>Opening Site</title><p>Opening your Site…</p><script>${BOOTSTRAP}</script>`,
          { headers: h },
        );
      }
      if (url.pathname === "/__kova/session") {
        if (
          request.method !== "POST" ||
          request.headers.get("origin") !== url.origin ||
          url.search ||
          request.headers.get("content-type")?.split(";")[0] !== "application/json"
        )
          return failure(403);
        const reader = request.body?.getReader();
        if (!reader) return failure(400);
        let body = "";
        try {
          const decoder = new TextDecoder();
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            if (body.length + next.value.length > 200) {
              await reader.cancel();
              return failure(400);
            }
            body += decoder.decode(next.value, { stream: true });
          }
        } finally {
          reader.releaseLock();
        }
        let token;
        try {
          const parsed = JSON.parse(body);
          if (Object.keys(parsed).length !== 1 || !TOKEN.test(parsed.token)) return failure(400);
          token = parsed.token;
        } catch {
          return failure(400);
        }
        const session = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const data = await rpc(admin, "redeem_kova_site_ticket", {
          p_site: siteId,
          p_ticket_hash: await sha256(token),
          p_session_hash: await sha256(session),
        });
        if (!data || typeof data.slug !== "string") return failure(403);
        const h = headers();
        h.set(
          "Set-Cookie",
          `__Host-kova-site=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900`,
        );
        h.set("Content-Type", "application/json");
        return new Response(JSON.stringify({ path: "/" + siteSlug(data.slug) + "/" }), {
          headers: h,
        });
      }
      if (!["GET", "HEAD"].includes(request.method)) return failure(405);
      const segments = url.pathname.split("/").slice(1);
      const slug = siteSlug(segments.shift());
      const path = sitePath(segments.join("/") || "index.html").path;
      const cookie = request.headers
        .get("cookie")
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("__Host-kova-site="))
        ?.slice("__Host-kova-site=".length);
      const sessionHash = cookie && TOKEN.test(cookie) ? await sha256(cookie) : null;
      const data = await rpc(admin, "read_kova_site_asset", {
        p_site: siteId,
        p_slug: slug,
        p_path: path,
        p_session_hash: sessionHash,
      });
      if (!data) return failure();
      if (data.redirectSlug) {
        const h = headers();
        h.set(
          "Location",
          "/" + siteSlug(data.redirectSlug) + "/" + (path === "index.html" ? "" : path),
        );
        return new Response(null, { status: 307, headers: h });
      }
      if (
        typeof data.base64 !== "string" ||
        data.base64.length > Math.ceil(SITE_LIMITS.fileBytes / 3) * 4 ||
        data.type !== sitePath(path).type ||
        !Number.isSafeInteger(data.size) ||
        data.size > SITE_LIMITS.fileBytes
      )
        return failure(503);
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      if (bytes.byteLength !== data.size || (await sha256(bytes)) !== data.sha256)
        return failure(503);
      const h = headers();
      h.set("Content-Type", data.type + (data.type.startsWith("text/") ? "; charset=utf-8" : ""));
      h.set("Content-Length", String(bytes.byteLength));
      return new Response(request.method === "HEAD" ? null : bytes, { headers: h });
    } catch {
      return failure();
    }
  };
}
