import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
export const BROWSER_NETWORK_LIMITS = Object.freeze({
  requestBytes: 65536,
  responseBytes: 2 * 1024 * 1024,
  headerBytes: 16384,
  timeoutMs: 10000,
});
const fail = () => {
  throw new Error("work_browser_network_denied");
};
export function publicBrowserIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function browserOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/" ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/i.test(url.hostname)
  )
    fail();
  return url.origin;
}
export function browserDestination(raw, origins) {
  if (typeof raw !== "string" || raw.length > 4096) fail();
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !origins.includes(url.origin) ||
    isIP(url.hostname)
  )
    fail();
  url.hash = "";
  return url;
}
function boundedHeaders(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  let bytes = 0;
  const output = {};
  for (const [name, value] of Object.entries(input)) {
    if (!/^[a-z0-9-]{1,80}$/i.test(name) || typeof value !== "string" || /[\r\n\0]/.test(value))
      fail();
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value);
    if (bytes > BROWSER_NETWORK_LIMITS.headerBytes) fail();
    if (allowed.has(name.toLowerCase())) output[name.toLowerCase()] = value;
  }
  return output;
}
const requestHeaders = new Set([
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
]);
const responseHeaders = new Set([
  "content-type",
  "content-language",
  "cache-control",
  "set-cookie",
  "location",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "vary",
  "content-security-policy",
  "x-frame-options",
  "referrer-policy",
]);
/** Only this host broker has network. The browser container has --network=none.
 * No ambient credentials, proxy settings, redirects, or connection reuse. */
export function createBrowserEgress(
  { origins, assertAuthority },
  { resolve = lookup, request = httpsRequest } = {},
) {
  const allowed = origins.map(browserOrigin);
  if (!allowed.length || allowed.length > 20 || new Set(allowed).size !== allowed.length) fail();
  return async (input, { signal, allowWrites = false } = {}) => {
    const url = browserDestination(input?.url, allowed),
      method = input.method;
    if (
      ![
        "GET",
        "HEAD",
        ...(allowWrites ? ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] : []),
      ].includes(method)
    )
      fail();
    const headers = boundedHeaders(input.headers ?? {}, requestHeaders);
    if (
      typeof input.bodyBase64 !== "string" ||
      input.bodyBase64.length > Math.ceil(BROWSER_NETWORK_LIMITS.requestBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bodyBase64)
    )
      fail();
    const body = Buffer.from(input.bodyBase64, "base64");
    if (
      body.toString("base64") !== input.bodyBase64 ||
      body.length > BROWSER_NETWORK_LIMITS.requestBytes ||
      (["GET", "HEAD"].includes(method) && body.length)
    )
      fail();
    const current = AbortSignal.any([
      signal ?? new AbortController().signal,
      AbortSignal.timeout(BROWSER_NETWORK_LIMITS.timeoutMs),
    ]);
    current.throwIfAborted();
    await assertAuthority();
    current.throwIfAborted();
    let abortDns;
    const cancelled = new Promise((_, reject) => {
      abortDns = () => reject(new Error("work_browser_network_denied"));
      current.addEventListener("abort", abortDns, { once: true });
    });
    let addresses;
    try {
      addresses = await Promise.race([resolve(url.hostname, { all: true, family: 4 }), cancelled]);
    } finally {
      current.removeEventListener("abort", abortDns);
    }
    if (
      !Array.isArray(addresses) ||
      !addresses.length ||
      addresses.length > 16 ||
      addresses.some((item) => item.family !== 4 || !publicBrowserIPv4(item.address))
    )
      fail();
    await assertAuthority();
    current.throwIfAborted();
    const result = await new Promise((resolveResult, reject) => {
      let settled = false,
        total = 0;
      const chunks = [];
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        error ? reject(new Error("work_browser_network_denied")) : resolveResult(value);
      };
      const req = request(
        {
          protocol: "https:",
          hostname: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          method,
          headers: {
            ...headers,
            "accept-encoding": "identity",
            ...(body.length ? { "content-length": String(body.length) } : {}),
          },
          servername: url.hostname,
          rejectUnauthorized: true,
          agent: false,
          family: 4,
          signal: current,
          lookup: (_hostname, options, callback) =>
            options?.all
              ? callback(null, [{ address: addresses[0].address, family: 4 }])
              : callback(null, addresses[0].address, 4),
        },
        (response) => {
          let rawHeaders = {};
          try {
            for (const [name, value] of Object.entries(response.headers)) {
              if (value !== undefined)
                rawHeaders[name] = Array.isArray(value) ? value.join("\n") : String(value);
            }
            // Set-Cookie is the only multi-value header; keep separate values for Chromium.
            const cookies = response.headers["set-cookie"] ?? [];
            delete rawHeaders["set-cookie"];
            const safe = boundedHeaders(rawHeaders, responseHeaders);
            if (cookies.length) {
              if (
                !Array.isArray(cookies) ||
                cookies.some((value) => typeof value !== "string" || /[\r\n\0]/.test(value)) ||
                Buffer.byteLength(cookies.join("")) > 8192
              )
                fail();
              safe["set-cookie"] = cookies.join("\n");
            }
            if (response.statusCode >= 300 && response.statusCode < 400 && safe.location)
              browserDestination(new URL(safe.location, url).href, allowed);
            const encoding = response.headers["content-encoding"];
            const decoder =
              encoding === "gzip"
                ? createGunzip()
                : encoding === "deflate"
                  ? createInflate()
                  : encoding === "br"
                    ? createBrotliDecompress()
                    : null;
            if (encoding && !decoder && encoding !== "identity") fail();
            let compressed = 0;
            response.on("data", (chunk) => {
              compressed += chunk.length;
              if (compressed > BROWSER_NETWORK_LIMITS.responseBytes) {
                response.destroy();
                done(true);
              }
            });
            const stream = decoder ? response.pipe(decoder) : response;
            response.on("error", () => done(true));
            stream.on("error", () => done(true));
            stream.on("data", (chunk) => {
              total += chunk.length;
              if (total > BROWSER_NETWORK_LIMITS.responseBytes) {
                stream.destroy();
                response.destroy();
                done(true);
              } else chunks.push(Buffer.from(chunk));
            });
            stream.on("end", () =>
              done(null, {
                status: response.statusCode,
                headers: safe,
                bodyBase64: Buffer.concat(chunks).toString("base64"),
              }),
            );
          } catch {
            response.destroy();
            done(true);
          }
        },
      );
      req.on("error", () => done(true));
      req.end(body.length ? body : undefined);
    });
    await assertAuthority();
    current.throwIfAborted();
    return result;
  };
}
