import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PUBLIC_SITEMAP_ENTRIES } from "../../src/lib/seo-policy.mjs";

const readSource = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the root error boundary is deterministic, truthful, and privacy-safe", async () => {
  const root = await readSource("src/routes/__root.tsx");
  const errorStart = root.indexOf("function ErrorComponent");
  const errorEnd = root.indexOf("export const Route");
  const errorComponent = root.slice(errorStart, errorEnd);

  assert.ok(errorStart >= 0 && errorEnd > errorStart);
  assert.doesNotMatch(errorComponent, /randomUUID|correlationId/u);
  assert.doesNotMatch(errorComponent, /console\.(?:error|log|warn)/u);
  assert.doesNotMatch(errorComponent, /diagnostic details server-side|while we log/iu);
  assert.match(errorComponent, /Something went wrong while loading this page/u);
  assert.match(errorComponent, /contact support and describe what you were doing/u);
});

test("root metadata is route-aware and does not expose private infrastructure", async () => {
  const root = await readSource("src/routes/__root.tsx");

  assert.match(root, /robotsDirectiveForRoute/u);
  assert.match(root, /isPublicIndexableRoute/u);
  assert.match(root, /head:\s*\(\{ matches \}\)/u);
  assert.match(root, /headers:\s*\(\{ matches \}\)/u);
  assert.match(root, /globalNotFound\s*\?\s*\[match\.status, "notFound"\]/u);
  assert.match(root, /"X-Robots-Tag"/u);
  assert.match(root, /scripts:\s*indexable/u);
  assert.doesNotMatch(root, /\.supabase\.co/u);
  assert.doesNotMatch(root, /crypto\.randomUUID/u);
});

test("robots and sitemap share an explicit public/private boundary", async () => {
  const [robots, sitemap, policy, routeTree] = await Promise.all([
    readSource("public/robots.txt"),
    readSource("src/routes/sitemap[.]xml.ts"),
    readSource("src/lib/seo-policy.mjs"),
    readSource("src/routeTree.gen.ts"),
  ]);

  for (const path of ["/api/", "/account", "/chat", "/projects", "/settings", "/work"]) {
    assert.match(robots, new RegExp(`^Disallow: ${path.replace("/", "\\/")}`, "mu"), path);
  }

  assert.match(robots, /^Sitemap: https:\/\/kovagpt\.com\/sitemap\.xml$/mu);
  assert.doesNotMatch(robots, /lovable/iu);
  assert.match(sitemap, /PUBLIC_SITEMAP_ENTRIES/u);
  assert.doesNotMatch(sitemap, /path:\s*["']\/(?:api|account|chat|projects|settings|work)/u);
  assert.match(policy, /"\/chatgpt-alternative"/u);

  for (const { path } of PUBLIC_SITEMAP_ENTRIES) {
    if (path === "/") continue;
    assert.ok(routeTree.includes(`fullPath: '${path}'`), `${path} must resolve to a real route`);
  }
});

test("the comparison landing keeps KovaGPT dominant and avoids unverified claims", async () => {
  const landing = await readSource("src/routes/chatgpt-alternative.tsx");

  assert.match(landing, /h1="KovaGPT, built for focused AI work"/u);
  assert.match(landing, /independently developed and branded product/u);
  assert.match(landing, /not affiliated with, endorsed by, or sponsored by OpenAI/u);
  assert.match(landing, /ChatGPT is a trademark of OpenAI/u);
  assert.doesNotMatch(
    landing,
    /generous daily allowance|send email|never sell your data|real ChatGPT alternative|real work in your inbox/iu,
  );
});

test("the public status page does not invent live monitoring state", async () => {
  const status = await readSource("src/routes/status.tsx");

  assert.match(status, /not connected to automated incident monitoring/u);
  assert.match(status, /does not claim that all\s+systems are operational/u);
  assert.match(status, /href="\/api\/health"/u);
  assert.doesNotMatch(status, /No known issues|All systems operational/iu);
});
