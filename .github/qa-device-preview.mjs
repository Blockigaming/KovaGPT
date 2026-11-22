import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, request } from "node:http";
import { pathToFileURL } from "node:url";

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
const { resolveFixtureFunctionName } = await import(
  pathToFileURL(process.cwd() + "/tests/e2e/server-function-fixture.ts").href
);
const accountId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const chatId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sampleText = Array.from({ length: 20 }, (_, index) =>
  `### Step ${index + 1}\n\nReview the draft, verify the layout, and keep the key controls in reach.`,
).join("\n\n");
const session = {
  accountId, sessionId, email: "device-qa@example.invalid", emailVerified: true,
  displayName: "Device QA", assuranceLevel: "aal1",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};
const history = { ownerId: accountId, epoch: "44444444-4444-4444-8444-444444444444", records: [], nextCursor: 0, currentVersion: 0, hasMore: false };
const sampleConversation = {
  id: chatId, revision: 1, sync_version: 1,
  mutation_id: "55555555-5555-4555-8555-555555555555",
  archived: false, deleted_at: null,
  payload: {
    id: chatId, title: "Device verification", mode: "instant",
    createdAt: Date.now(), updatedAt: Date.now(),
    messages: [
      { id: "prompt-a", role: "user", content: "Draft a sample release checklist." },
      { id: "answer-a", role: "assistant", content: sampleText },
    ],
  },
};
const fixtureResults = {
  getMyPlanTier: { ownerId: accountId, tier: "free" },
  getMyDailyUsage: { chats: 0, images: 0, uploads: 0, resetsAt: "2026-12-31T00:00:00.000Z" },
  getSubscriptionSummary: { effectiveTier: "free", tier: "free" },
  getChatCustomRules: { instructions: "", enabled: false },
};
const json = (outgoing, value) => {
  outgoing.writeHead(200, { ...lockedHeaders, "content-type": "application/json; charset=utf-8" });
  outgoing.end(JSON.stringify(value));
};

createServer((incoming, outgoing) => {
  const url = new URL(incoming.url, "http://127.0.0.1");
  const path = url.pathname;
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
  if (path === "/api/auth/session") return json(outgoing, { session });
  if (path === "/api/auth/token") {
    return json(outgoing, { session, accessToken: "device-qa-fixture-only", expiresIn: 3600 });
  }
  if (path === "/api/chat/history" && incoming.method === "GET") {
    return json(outgoing, {
      ...history,
      records: Number(url.searchParams.get("cursor")) < 1 ? [sampleConversation] : [],
      nextCursor: 1,
      currentVersion: 1,
    });
  }
  if (path.startsWith("/_serverFn/")) {
    const name = (resolveFixtureFunctionName(path.split("/").at(-1)) ?? "").split("_")[0];
    return json(outgoing, { result: fixtureResults[name] ?? [], context: {} });
  }
  if (path === "/api/chat" && incoming.method === "POST") {
    outgoing.writeHead(200, { ...lockedHeaders, "content-type": "text/event-stream" });
    return outgoing.end(`data: ${JSON.stringify({ choices: [{ delta: { content: sampleText } }] })}\n\ndata: [DONE]\n\n`);
  }
  if (path.startsWith("/api/") && !["/api/version", "/api/health"].includes(path))
    return json(outgoing, {});

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
