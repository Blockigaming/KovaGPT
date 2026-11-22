import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, request } from "node:http";

const digest = process.env.KOVA_QA_CODE_SHA256 ?? "";
if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Missing preview access-code digest");
const expectedDigest = Buffer.from(digest, "hex");
const codeMatches = (code) =>
  /^[a-f0-9]{64}$/.test(code) &&
  timingSafeEqual(createHash("sha256").update(code).digest(), expectedDigest);

const lockedHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};
const scopePolicy =
  "connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; form-action 'self'; frame-src 'none'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'";

createServer((incoming, outgoing) => {
  const path = new URL(incoming.url, "http://127.0.0.1").pathname;
  const enrollment = path.match(/^\/_qa\/([a-f0-9]{64})$/);
  if (incoming.method === "GET" && enrollment && codeMatches(enrollment[1])) {
    outgoing.writeHead(303, {
      ...lockedHeaders,
      location: "/",
      "set-cookie": `__Host-kova-qa=${enrollment[1]}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`,
    });
    return outgoing.end();
  }
  const cookie = incoming.headers.cookie?.match(/(?:^|;\s*)__Host-kova-qa=([a-f0-9]{64})(?=;|$)/);
  if (!cookie || !codeMatches(cookie[1])) {
    outgoing.writeHead(404, lockedHeaders);
    return outgoing.end();
  }

  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 4189,
      method: incoming.method,
      path: incoming.url,
      headers: {
        accept: incoming.headers.accept ?? "*/*",
        "accept-language": incoming.headers["accept-language"] ?? "en",
        "content-type": incoming.headers["content-type"] ?? "application/octet-stream",
        "user-agent": incoming.headers["user-agent"] ?? "",
      },
    },
    (response) => {
      const headers = { ...response.headers, ...lockedHeaders };
      delete headers["set-cookie"];
      if (String(headers["content-type"]).includes("text/html")) {
        const existing = headers["content-security-policy"];
        headers["content-security-policy"] = existing ? [existing, scopePolicy] : scopePolicy;
      }
      outgoing.writeHead(response.statusCode ?? 502, headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502, lockedHeaders);
    outgoing.end();
  });
  incoming.pipe(upstream);
}).listen(4190, "127.0.0.1");
