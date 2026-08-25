import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_LOVABLE_PATHS = [
  "/.lovable/oauth/consent",
  "/lovable/email/auth/preview",
  "/lovable/email/auth/webhook",
  "/lovable/email/queue/process",
  "/lovable/email/suppression",
  "/lovable/email/transactional/preview",
  "/lovable/email/transactional/send",
];
const DEFAULT_REQUIRED_CAPABILITIES = [
  "productionUrl",
  "auth",
  "supabase",
  "aiProvider",
  "agentRunner",
  "stripe",
  "email",
  "google",
  "github",
  "scheduledTasks",
  "images",
  "research",
  "storage",
  "migrations",
];

function exactSha(value, name = "KOVA_EXPECTED_SHA") {
  if (!/^[a-f0-9]{40}$/u.test(value ?? "")) {
    throw new Error(`${name} must be an exact lowercase 40-character SHA`);
  }
  return value;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20_000) {
  return fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function readJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function requireHeader(headers, name, pattern) {
  const value = headers.get(name);
  assert.ok(value, `${name} header is missing`);
  if (pattern) assert.match(value, pattern, `${name} header is invalid`);
  return value;
}

function parseSse(text) {
  let content = "";
  const activities = [];
  let done = false;
  let usageObserved = false;
  for (const frame of text.split(/\r?\n\r?\n/u)) {
    const dataLines = frame
      .split(/\r?\n/u)
      .filter((candidate) => candidate.startsWith("data:"))
      .map((candidate) => candidate.slice(5).trim());
    for (const data of dataLines) {
      if (data === "[DONE]") {
        done = true;
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (payload?.usage) usageObserved = true;
      const delta = payload?.choices?.[0]?.delta;
      if (typeof delta?.content === "string") content += delta.content;
      if (delta?.kind === "activity") activities.push(delta);
    }
  }
  return { content, activities, done, usageObserved };
}

async function runChatSmoke({
  baseUrl,
  accessToken,
  label,
  prompt,
  mode,
  clientTool,
  requireActivity = false,
  timeoutMs = 180_000,
}) {
  const response = await fetchWithTimeout(
    new URL("/api/chat", baseUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        mode,
        temporary: true,
        ...(clientTool ? { clientTool } : {}),
      }),
    },
    timeoutMs,
  );
  assert.equal(response.status, 200, `${label} chat smoke returned ${response.status}`);
  assert.ok(
    (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/event-stream"),
    `${label} chat smoke did not return text/event-stream`,
  );
  const stream = parseSse(await response.text());
  assert.equal(stream.done, true, `${label} chat stream did not terminate cleanly`);
  assert.ok(stream.content.trim().length > 0, `${label} chat stream returned no content`);
  if (requireActivity) {
    assert.ok(stream.activities.length > 0, `${label} produced no observable activity event`);
  }
  return {
    mode,
    clientTool: clientTool ?? null,
    responseCharacters: stream.content.length,
    activityEvents: stream.activities.length,
    usageObserved: stream.usageObserved,
    cleanTermination: stream.done,
  };
}

async function runImageSmoke({ baseUrl, accessToken }) {
  const response = await fetchWithTimeout(
    new URL("/api/generate-image", baseUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "A small cobalt-blue geometric letter K on a plain white background",
        operation: "generate",
        aspectRatio: "1:1",
        quality: "low",
        outputFormat: "png",
        transparentBackground: false,
        n: 1,
      }),
    },
    120_000,
  );
  assert.equal(response.status, 200, `image smoke returned ${response.status}`);
  const body = await readJson(response, "/api/generate-image");
  assert.match(body.imageUrl ?? "", /^(?:data:image\/png;base64,|https:\/\/)/u);
  assert.equal(body.metadata?.operation, "generate");
  assert.ok(
    typeof body.model === "string" && body.model.length > 0,
    "image model identity missing",
  );
  return {
    modelPresent: true,
    outputKind: String(body.imageUrl).startsWith("data:") ? "inline" : "https",
    operation: body.metadata.operation,
  };
}

function requiredCapabilities(env) {
  return (env.KOVA_REQUIRED_READINESS_CAPABILITIES || DEFAULT_REQUIRED_CAPABILITIES.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function verifyProductionSystem({ env = process.env } = {}) {
  const baseUrl = new URL(env.KOVA_PRODUCTION_BASE_URL || "https://kovagpt.com");
  assert.equal(baseUrl.protocol, "https:", "production base URL must use HTTPS");
  const expectedSha = exactSha(env.KOVA_EXPECTED_SHA);
  const expectedEnvironment = env.KOVA_EXPECTED_ENVIRONMENT || "production";
  const readinessToken = env.KOVA_READINESS_TOKEN?.trim();
  const accessToken = env.KOVA_PRODUCTION_ACCESS_TOKEN?.trim();
  const runGeneration = env.KOVA_RUN_GENERATION_SMOKE === "1";
  const runTool = env.KOVA_RUN_TOOL_SMOKE === "1";
  const runResearch = env.KOVA_RUN_RESEARCH_SMOKE === "1";
  const runImage = env.KOVA_RUN_IMAGE_SMOKE === "1";
  const requireCloudflare = env.KOVA_REQUIRE_CLOUDFLARE !== "0";
  const allowMinimalReadiness = env.KOVA_ALLOW_MINIMAL_READINESS === "1";
  const evidencePath =
    env.KOVA_PRODUCTION_EVIDENCE_PATH || "artifacts/release/day16-production-system.json";

  if (!readinessToken && !allowMinimalReadiness) {
    throw new Error("KOVA_READINESS_TOKEN is required for final production readiness evidence");
  }
  if ((runGeneration || runTool || runResearch || runImage) && !accessToken) {
    throw new Error("KOVA_PRODUCTION_ACCESS_TOKEN is required for authenticated capability smokes");
  }

  const healthResponse = await fetchWithTimeout(new URL("/api/health", baseUrl));
  assert.equal(healthResponse.status, 200, `/api/health returned ${healthResponse.status}`);
  const health = await readJson(healthResponse, "/api/health");
  assert.equal(health.ok, true);
  assert.equal(health.app, "KovaGPT");
  assert.equal(health.environment, expectedEnvironment);
  assert.equal(health.build, expectedSha, "health build does not match release SHA");

  const versionResponse = await fetchWithTimeout(new URL("/api/version", baseUrl));
  assert.equal(versionResponse.status, 200, `/api/version returned ${versionResponse.status}`);
  const version = await readJson(versionResponse, "/api/version");
  assert.equal(version.sha, expectedSha, "version SHA does not match release SHA");
  assert.equal(requireHeader(versionResponse.headers, "x-kova-build"), expectedSha);
  assert.match(requireHeader(versionResponse.headers, "cache-control"), /no-store/u);
  if (requireCloudflare) requireHeader(versionResponse.headers, "cf-ray");

  const homeResponse = await fetchWithTimeout(baseUrl);
  assert.equal(homeResponse.status, 200, `home returned ${homeResponse.status}`);
  const securityHeaders = {
    hsts: requireHeader(homeResponse.headers, "strict-transport-security", /max-age=/u),
    csp: requireHeader(homeResponse.headers, "content-security-policy", /default-src/u),
    nosniff: requireHeader(homeResponse.headers, "x-content-type-options", /^nosniff$/u),
    referrerPolicy: requireHeader(homeResponse.headers, "referrer-policy"),
    permissionsPolicy: requireHeader(homeResponse.headers, "permissions-policy"),
  };
  assert.equal(homeResponse.headers.get("x-powered-by"), null, "x-powered-by must not be exposed");
  const homeText = await homeResponse.text();
  assert.doesNotMatch(
    homeText,
    /lovable\.(?:app|dev)|@lovable\.dev|LOVABLE_/iu,
    "public HTML contains Lovable runtime text",
  );

  const livezResponse = await fetchWithTimeout(new URL("/api/livez", baseUrl));
  assert.equal(livezResponse.status, 200, `/api/livez returned ${livezResponse.status}`);
  assert.match(requireHeader(livezResponse.headers, "cache-control"), /no-store/u);

  const readyHeaders = readinessToken ? { "x-readiness-token": readinessToken } : {};
  const readyResponse = await fetchWithTimeout(new URL("/api/readyz", baseUrl), {
    headers: readyHeaders,
  });
  const ready = await readJson(readyResponse, "/api/readyz");
  assert.equal(readyResponse.status, 200, `/api/readyz returned ${readyResponse.status}`);
  assert.equal(ready.status, "ready", "production readiness is not ready");
  const capabilityEvidence = {};
  if (readinessToken) {
    assert.ok(
      Object.keys(ready.capabilities ?? {}).length > 0,
      "monitoring token exposed no readiness map",
    );
    for (const name of requiredCapabilities(env)) {
      const state = ready.capabilities?.[name]?.state;
      assert.equal(state, "ready", `required capability ${name} is ${state ?? "missing"}`);
      capabilityEvidence[name] = state;
    }
  }

  const legacyStatuses = {};
  for (const path of LEGACY_LOVABLE_PATHS) {
    const response = await fetchWithTimeout(new URL(path, baseUrl));
    assert.equal(response.status, 404, `${path} must be absent, not a compatibility runtime`);
    legacyStatuses[path] = response.status;
  }

  const unauthorizedStatus = await fetchWithTimeout(new URL("/api/google/status", baseUrl));
  assert.equal(
    unauthorizedStatus.status,
    401,
    "protected connector status must reject signed-out access",
  );

  let authenticated = null;
  if (accessToken) {
    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    const response = await fetchWithTimeout(new URL("/api/google/status", baseUrl), {
      headers: authHeaders,
    });
    assert.ok(
      [200, 503].includes(response.status),
      `authenticated connector status returned ${response.status}`,
    );
    authenticated = { googleStatus: response.status };
  }

  const generation = {};
  if (runGeneration) {
    generation.chat = await runChatSmoke({
      baseUrl,
      accessToken,
      label: "basic generation",
      prompt: "Reply with exactly KOVA_PRODUCTION_SMOKE_OK and nothing else.",
      mode: "instant",
    });
  }
  if (runTool) {
    generation.webSearch = await runChatSmoke({
      baseUrl,
      accessToken,
      label: "web search",
      prompt:
        "Use web search to identify the official KovaGPT homepage, then answer with one cited sentence.",
      mode: "thinking",
      clientTool: "web_search",
      requireActivity: true,
    });
  }
  if (runResearch) {
    generation.deepResearch = await runChatSmoke({
      baseUrl,
      accessToken,
      label: "deep research",
      prompt:
        "Research the official KovaGPT homepage and produce a concise source-backed verification report.",
      mode: "pro",
      clientTool: "deep_research",
      requireActivity: true,
      timeoutMs: 300_000,
    });
  }
  if (runImage) {
    generation.image = await runImageSmoke({ baseUrl, accessToken });
  }

  const evidence = {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    origin: baseUrl.origin,
    expectedSha,
    expectedEnvironment,
    health: { status: healthResponse.status, environment: health.environment, build: health.build },
    version: { status: versionResponse.status, sha: version.sha },
    readiness: {
      httpStatus: readyResponse.status,
      status: ready.status,
      detailed: Boolean(readinessToken),
      requiredCapabilities: capabilityEvidence,
    },
    cloudflareRequired: requireCloudflare,
    cloudflareObserved: Boolean(versionResponse.headers.get("cf-ray")),
    securityHeaders,
    legacyLovablePaths: legacyStatuses,
    signedOutAuthorizationBoundary: unauthorizedStatus.status,
    authenticated,
    generation,
  };
  await mkdir(dirname(resolve(evidencePath)), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { ...evidence, evidencePath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await verifyProductionSystem();
  console.log(
    `KOVA_PRODUCTION_SYSTEM_VERIFICATION=PASS sha=${result.expectedSha} evidence=${result.evidencePath}`,
  );
}
