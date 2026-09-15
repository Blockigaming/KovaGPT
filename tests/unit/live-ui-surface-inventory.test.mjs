import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inventory = JSON.parse(readFileSync("docs/ui-ux/live-surface-inventory.json", "utf8"));
const pageProgress = JSON.parse(readFileSync("docs/ui-ux/page-by-page-progress.json", "utf8"));

test("live UI inventory records the complete discoverable source snapshot", () => {
  const inventorySource = readFileSync("scripts/ui-surface-inventory.mjs", "utf8");
  assert.match(inventory.snapshotDate, /^\d{4}-\d{2}-\d{2}$/u);
  assert.doesNotMatch(inventorySource, /const SNAPSHOT_DATE = ["']\d{4}-\d{2}-\d{2}["']/u);
  assert.match(inventorySource, /const REQUEST_TIMEOUT_MS = 30_000/u);
  assert.match(inventorySource, /signal: AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/u);
  assert.match(inventorySource, /request timed out after \$\{REQUEST_TIMEOUT_MS\}ms/u);
  assert.equal(inventory.openai.sitemapCount, 38);
  assert.equal(inventory.openai.uniqueUrlCount, 1706);
  assert.equal(inventory.chatgpt.sitemapEntryCount, 98);
  assert.ok(inventory.chatgpt.marketingNavigation.pathCount >= 49);
  assert.equal(inventory.chatgpt.authenticatedTemplates.observationDate, null);
  assert.equal(inventory.chatgpt.authenticatedTemplates.verification, "not_verified");
  assert.match(inventory.chatgpt.authenticatedTemplates.evidence, /not verified/u);
  assert.doesNotMatch(
    readFileSync("scripts/ui-surface-inventory.mjs", "utf8"),
    /authenticated navigation inspected read-only on \$\{SNAPSHOT_DATE\}/u,
  );

  assert.equal(new Set(inventory.openai.urls).size, inventory.openai.uniqueUrlCount);
  assert.equal(new Set(inventory.chatgpt.urls).size, inventory.chatgpt.sitemapEntryCount);
  assert.ok(inventory.openai.urls.every((url) => url.startsWith("https://openai.com/")));
  assert.ok(
    inventory.chatgpt.urls.every(
      (url) => url === "https://chatgpt.com" || url.startsWith("https://chatgpt.com/"),
    ),
  );
});

test("Kova inventory separates interface templates from service handlers", () => {
  const { kovagpt } = inventory;
  assert.equal(
    kovagpt.uiRouteTemplateCount + kovagpt.serviceRouteTemplateCount,
    kovagpt.routeTemplateCount,
  );
  assert.equal(kovagpt.routeTemplateCount, 174);
  assert.equal(kovagpt.uiRouteTemplateCount, 74);
  assert.equal(kovagpt.serviceRouteTemplateCount, 100);
  assert.ok(kovagpt.routeTemplates.some(({ route }) => route === "<root-shell>"));
  assert.equal(kovagpt.publicIndexContentSlugCount, 66);
  assert.equal(kovagpt.publicDetailPathCount, 478);
  assert.equal(kovagpt.publicRegistryPageCount, 544);
  assert.equal(kovagpt.reviewedPublicPathCount, 608);
  assert.equal(kovagpt.sitemapPathCount, 165);
  assert.equal(kovagpt.publicDetailPaths.includes("features/deep-research"), false);
  assert.ok(kovagpt.publicDetailPaths.includes("plans/pro"));
  assert.ok(kovagpt.publicDetailPaths.includes("apps/github"));
  assert.ok(kovagpt.publicDetailPaths.includes("features/voice"));
  assert.ok(kovagpt.publicDetailPaths.includes("apps/canva"));
  assert.ok(kovagpt.publicDetailPaths.includes("codex/pricing"));
  assert.ok(kovagpt.publicDetailPaths.includes("solutions/blueprints/knowledge-retrieval"));
  assert.ok(kovagpt.publicDetailPaths.includes("solutions/industries/healthcare"));
  assert.ok(kovagpt.publicDetailPaths.includes("solutions/use-case/research"));
  assert.ok(kovagpt.publicDetailPaths.includes("academy/ai-fundamentals"));
  assert.ok(
    kovagpt.publicDetailPaths.includes(
      "academy/chatgpt-work/how-business-operations-teams-use-codex",
    ),
  );
  assert.ok(kovagpt.publicDetailPaths.includes("policies/privacy-policy"));
  assert.ok(
    kovagpt.publicDetailPaths.includes(
      "policies/privacy-policy/california-privacy-rights-reporting",
    ),
  );
  assert.ok(
    kovagpt.publicDetailPaths.includes(
      "business/guides-and-resources/a-practical-guide-to-building-ai-agents",
    ),
  );
  assert.ok(kovagpt.publicDetailPaths.includes("business/solutions/finance/workflows"));
  assert.ok(kovagpt.publicDetailPaths.includes("business/plugins/google-drive"));
  assert.ok(kovagpt.publicDetailPaths.includes("business/partners/accenture"));
  assert.ok(kovagpt.publicDetailPaths.includes("form/model-behavior-feedback"));
  assert.ok(kovagpt.publicDetailPaths.includes("form/business/premium-offer"));
  assert.ok(kovagpt.publicDetailPaths.includes("global-affairs/a-primer-on-the-eu-ai-act"));
  assert.ok(
    kovagpt.publicDetailPaths.includes("global-affairs/the-washington-post-partners-with-openai"),
  );
  assert.equal(
    new Set(kovagpt.routeTemplates.map(({ route }) => route)).size,
    kovagpt.routeTemplateCount,
  );
  assert.match(inventory.scope.adaptationRule, /original Kova-branded equivalents/u);
  assert.match(
    readFileSync("scripts/ui-surface-inventory.mjs", "utf8"),
    /src\/lib\/public-content-expanded\.ts/u,
  );
});

test("strict UI progress gives every discovered page equal weight", () => {
  const { measurement, records } = pageProgress;
  const chatgptPaths = new Set([
    ...inventory.chatgpt.urls.map((url) => new URL(url).pathname.replace(/\/+$/u, "") || "/"),
    ...inventory.chatgpt.marketingNavigation.paths.map(
      (path) => new URL(path, "https://chatgpt.com").pathname.replace(/\/+$/u, "") || "/",
    ),
  ]);

  assert.equal(measurement.sourcePageCount, inventory.openai.uniqueUrlCount + chatgptPaths.size);
  assert.equal(records.length, measurement.sourcePageCount);
  assert.equal(records.filter(({ completed }) => completed).length, measurement.completedPageCount);
  assert.equal(measurement.completedPageCount, 532);
  assert.equal(measurement.remainingPageCount, 1320);
  assert.equal(measurement.completionPercent, 28.73);
  assert.equal(
    measurement.remainingPageCount,
    measurement.sourcePageCount - measurement.completedPageCount,
  );
  assert.ok(records.every(({ weight }) => weight === 1));
  assert.equal(
    new Set(records.map(({ source, sourceUrl }) => `${source}:${sourceUrl}`)).size,
    records.length,
  );
  assert.ok(
    records
      .filter(({ completed }) => completed)
      .every(({ sourcePath, kovaPath, status }) =>
        Boolean(sourcePath === kovaPath && status === "implemented_exact_path"),
      ),
  );

  for (const sourcePath of [
    "/academy",
    "/business-data",
    "/careers",
    "/charter",
    "/consumer-privacy",
    "/economic-research-exchange",
    "/enterprise-privacy",
    "/interview-guide",
    "/open-model-feedback",
    "/open-models",
    "/our-structure",
    "/policies",
    "/residency",
    "/safety",
    "/science",
    "/security-and-privacy",
    "/solutions",
    "/student-collective",
    "/transparency-and-content-moderation",
    "/trust-and-transparency",
    "/solutions/blueprints/knowledge-retrieval",
    "/solutions/blueprints/mcpkit",
    "/solutions/industries/financial-services",
    "/solutions/industries/government",
    "/solutions/industries/healthcare",
    "/solutions/industries/retail",
    "/solutions/use-case/agents",
    "/solutions/use-case/coding",
    "/solutions/use-case/content-creation",
    "/solutions/use-case/data-analysis",
    "/solutions/use-case/research",
  ]) {
    const record = records.find(
      (entry) => entry.source === "openai.com" && entry.sourcePath === sourcePath,
    );
    assert.equal(record?.completed, true, sourcePath);
    assert.equal(record?.kovaPath, sourcePath, sourcePath);
  }

  for (const record of records.filter(({ sourceFamily }) => sourceFamily === "policy_detail")) {
    assert.equal(record.completed, true, record.sourcePath);
    assert.equal(record.kovaPath, record.sourcePath, record.sourcePath);
  }

  for (const record of records.filter(({ sourceFamily }) => sourceFamily === "business_detail")) {
    if (!record.sourcePath.startsWith("/business/")) continue;
    assert.equal(record.completed, true, record.sourcePath);
    assert.equal(record.kovaPath, record.sourcePath, record.sourcePath);
  }

  for (const record of records.filter(
    ({ sourceFamily }) => sourceFamily === "global-affairs_detail",
  )) {
    assert.equal(record.completed, true, record.sourcePath);
    assert.equal(record.kovaPath, record.sourcePath, record.sourcePath);
  }
});
