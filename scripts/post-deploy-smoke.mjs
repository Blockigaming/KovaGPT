const base = new URL(process.env.KOVA_SMOKE_BASE_URL || "http://127.0.0.1:4173");
const expectedSha = process.env.KOVA_EXPECTED_SHA;
if (!expectedSha) throw new Error("KOVA_EXPECTED_SHA is required");

async function read(path, expectedType) {
  const response = await fetch(new URL(path, base), { redirect: "manual" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes(expectedType))
    throw new Error(`${path} returned ${type || "no content type"}`);
  return { response, body: await response.text() };
}

const version = await read("/api/version", "application/json");
const identity = JSON.parse(version.body);
if (identity.sha !== expectedSha || version.response.headers.get("x-kova-build") !== expectedSha) {
  throw new Error(`deployed build ${identity.sha || "unknown"} does not match ${expectedSha}`);
}

for (const path of ["/", "/pricing", "/modes", "/~oauth/callback", "/robots.txt", "/sitemap.xml"]) {
  const { body } = await read(
    path,
    path.endsWith(".xml") ? "xml" : path.endsWith(".txt") ? "text" : "text/html",
  );
  if (/voice synthesis|voice mode|Basic Mode|Creative Mode|Precise Mode/i.test(body)) {
    throw new Error(`${path} contains retired product claims`);
  }
}

const missing = await fetch(new URL(`/release-smoke-missing-${Date.now()}`, base));
if (missing.status !== 404)
  throw new Error(`unknown route returned ${missing.status}, expected 404`);
console.log(`KovaGPT deployment ${expectedSha} passed smoke checks at ${base.origin}`);
