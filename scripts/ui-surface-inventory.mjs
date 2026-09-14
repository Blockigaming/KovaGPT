import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLIC_BUSINESS_PATHS,
  PUBLIC_ECOSYSTEM_PATHS,
  PUBLIC_FORM_PATHS,
  PUBLIC_POLICY_PATHS,
  PUBLIC_REVIEW_PATHS,
  PUBLIC_SITEMAP_ENTRIES,
} from "../src/lib/seo-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "docs/ui-ux/live-surface-inventory.json");
const PAGE_PROGRESS_OUTPUT = resolve(ROOT, "docs/ui-ux/page-by-page-progress.json");
const SNAPSHOT_DATE =
  process.env.KOVA_UI_SNAPSHOT_DATE?.trim() || new Date().toISOString().slice(0, 10);
const AUTHENTICATED_OBSERVATION_DATE =
  process.env.KOVA_CHATGPT_AUTHENTICATED_OBSERVATION_DATE?.trim() || null;

if (
  AUTHENTICATED_OBSERVATION_DATE &&
  !/^\d{4}-\d{2}-\d{2}$/u.test(AUTHENTICATED_OBSERVATION_DATE)
) {
  throw new Error("KOVA_CHATGPT_AUTHENTICATED_OBSERVATION_DATE must use YYYY-MM-DD");
}

const CHATGPT_AUTHENTICATED_TEMPLATES = Object.freeze([
  "/",
  "/c/$conversationId",
  "/images",
  "/library",
  "/projects",
  "/projects/$projectId",
  "/scheduled",
  "/plugins",
  "profile-dialog",
  "personalization-dialog",
  "settings-dialog",
  "help-dialog",
]);

function extractLocations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "KovaGPT-UI-Surface-Audit/1.0" },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return Object.fromEntries([...result].sort((left, right) => right[1] - left[1]));
}

function openAiFamily(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (!parts.length) return "home";
  if (parts[0] === "index") return "article_detail";
  if (parts[0] === "business" && parts[1] === "plugins") return "plugin_detail";
  if (parts[0] === "business" && parts[1] === "partners") return "partner_detail";
  if (parts[0] === "form") return "form_detail";
  if (parts[0] === "academy" && parts.length > 1) return "academy_detail";
  if (parts[0] === "policies" && parts.length > 1) return "policy_detail";
  return `${parts[0]}${parts.length > 1 ? "_detail" : "_index"}`;
}

function isLocaleRoot(pathname) {
  return /^\/[a-z]{2,3}(?:-[A-Za-z0-9]{2,4}){0,2}\/?$/u.test(pathname);
}

function chatGptFamily(url) {
  const pathname = new URL(url).pathname;
  if (pathname === "/") return "home";
  if (isLocaleRoot(pathname)) return "localized_home";
  if (pathname.startsWith("/g/")) return "public_gpt_detail";
  if (pathname.startsWith("/translate/")) return "translation_tool_detail";
  if (pathname.startsWith("/writing/")) return "writing_tool_detail";
  return `${pathname.split("/").filter(Boolean)[0]}_index`;
}

function normalizeMarketingPath(href) {
  const url = new URL(href, "https://chatgpt.com");
  if (url.origin !== "https://chatgpt.com") return null;
  if (url.pathname.startsWith("/cdn/") || url.pathname === "/favicon.ico") return null;
  const firstSegment = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,4}){0,2}$/u.test(firstSegment)) return null;
  const normalized = url.pathname.replace(/\/\.\/?$/u, "/").replace(/\/{2,}/gu, "/");
  return normalized === "/" ? normalized : normalized.replace(/\/$/u, "");
}

function normalizePath(urlOrPath, baseUrl = "https://kovagpt.com") {
  const url = new URL(urlOrPath, baseUrl);
  const normalized = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/+$/u, "");
  return normalized || "/";
}

async function collectOpenAi() {
  const indexUrl = "https://openai.com/sitemap.xml";
  const sitemapUrls = extractLocations(await fetchText(indexUrl));
  const sitemapRows = await Promise.all(
    sitemapUrls.map(async (url) => {
      const urls = extractLocations(await fetchText(url));
      return { name: new URL(url).pathname.split("/").filter(Boolean).at(-1), url, urls };
    }),
  );
  const entries = sitemapRows.flatMap((row) => row.urls);
  const urls = [...new Set(entries)].sort();
  return {
    indexUrl,
    sitemapCount: sitemapRows.length,
    sitemapEntryCount: entries.length,
    uniqueUrlCount: urls.length,
    familyCounts: counts(urls.map(openAiFamily)),
    sitemapFamilies: sitemapRows.map(({ name, url, urls: familyUrls }) => ({
      name,
      url,
      entryCount: familyUrls.length,
    })),
    urls,
  };
}

async function collectChatGpt() {
  const sitemapUrl = "https://chatgpt.com/sitemap.xml";
  const urls = [...new Set(extractLocations(await fetchText(sitemapUrl)))].sort();
  const marketingSource = "https://chatgpt.com/features/voice/";
  const marketingHtml = await fetchText(marketingSource);
  const marketingPaths = [
    ...new Set(
      [...marketingHtml.matchAll(/href=["']([^"']+)["']/gu)]
        .map((match) => normalizeMarketingPath(match[1]))
        .filter(Boolean),
    ),
  ].sort();
  return {
    sitemapUrl,
    sitemapEntryCount: urls.length,
    familyCounts: counts(urls.map(chatGptFamily)),
    urls,
    marketingNavigation: {
      source: marketingSource,
      pathCount: marketingPaths.length,
      paths: marketingPaths,
    },
    authenticatedTemplates: {
      evidence: AUTHENTICATED_OBSERVATION_DATE
        ? `Manual authenticated navigation observation supplied for ${AUTHENTICATED_OBSERVATION_DATE}.`
        : "Static authenticated template inventory; not verified by this public audit run.",
      observationDate: AUTHENTICATED_OBSERVATION_DATE,
      verification: AUTHENTICATED_OBSERVATION_DATE ? "manually_supplied" : "not_verified",
      templates: CHATGPT_AUTHENTICATED_TEMPLATES,
    },
  };
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
    )
  ).flat();
}

function isKovaUiRoute(route, file) {
  return !(
    route.startsWith("/api/") ||
    route.startsWith("/.mcp/") ||
    route.startsWith("/.well-known/") ||
    file.includes("/routes/api/") ||
    file.includes("/routes/oauth/mcp/") ||
    file.endsWith("/routes/mcp.ts") ||
    route === "/email/unsubscribe" ||
    route === "/sitemap.xml"
  );
}

function extractPublicDetailPaths(source) {
  const registry = source.slice(source.indexOf("export const PUBLIC_DETAIL_PAGES"));
  const paths = [
    ...[...registry.matchAll(/\bdetail\(\s*"([^"]+)"\s*,\s*"([^"]+)"/gu)].map(
      (match) => `${match[1]}/${match[2]}`,
    ),
    ...[
      ...registry.matchAll(
        /\b(workflow|business|app|unavailableApp|unavailableFeature|unavailablePlan|translationDetail)\(\s*"([^"]+)"/gu,
      ),
    ].map((match) => {
      const section =
        match[1] === "workflow"
          ? "use-cases"
          : match[1] === "app" || match[1] === "unavailableApp"
            ? "apps"
            : match[1] === "unavailableFeature"
              ? "features"
              : match[1] === "unavailablePlan"
                ? "plans"
                : match[1] === "translationDetail"
                  ? "translate"
                  : match[1];
      return `${section}/${match[2]}`;
    }),
  ];
  const planTiers =
    source
      .match(/const planPages = \(\[([^\]]+)\]/u)?.[1]
      ?.match(/"([^"]+)"/gu)
      ?.map((tier) => `plans/${tier.slice(1, -1)}`) ?? [];
  return [...new Set([...paths, ...planTiers])].sort();
}

async function collectKova() {
  const routeFiles = (await walk(resolve(ROOT, "src/routes"))).filter((file) =>
    /\.tsx?$/u.test(file),
  );
  const routeRows = [];
  for (const file of routeFiles) {
    const source = await readFile(file, "utf8");
    const match = source.match(/createFileRoute\("([^"]+)"\)/u);
    const rootShell = source.includes("createRootRouteWithContext");
    if (!match && !rootShell) continue;
    routeRows.push({ route: rootShell ? "<root-shell>" : match[1], file: relative(ROOT, file) });
  }
  routeRows.sort((left, right) => left.route.localeCompare(right.route));
  const publicContent = (
    await Promise.all(
      ["src/lib/public-content.ts", "src/lib/public-content-expanded.ts"].map((file) =>
        readFile(resolve(ROOT, file), "utf8"),
      ),
    )
  ).join("\n");
  const publicSlugs = [...publicContent.matchAll(/\bpage\(\s*"([^"]+)"/gu)]
    .map((match) => match[1])
    .sort();
  const publicDetailContent = await readFile(
    resolve(ROOT, "src/lib/public-detail-content.ts"),
    "utf8",
  );
  const publicSolutionContent = await readFile(
    resolve(ROOT, "src/lib/public-solution-content.ts"),
    "utf8",
  );
  const publicAcademyContent = await readFile(
    resolve(ROOT, "src/lib/public-academy-content.ts"),
    "utf8",
  );
  const publicDetailPaths = [
    ...new Set([
      ...extractPublicDetailPaths(publicDetailContent),
      ...[...publicSolutionContent.matchAll(/\bsolution\(\s*"([^"]+)"\s*,\s*"([^"]+)"/gu)].map(
        (match) => `solutions/${match[1]}/${match[2]}`,
      ),
      ...[...publicAcademyContent.matchAll(/\bslug:\s*"([^"]+)"/gu)].map(
        (match) => `academy/${match[1]}`,
      ),
      ...PUBLIC_POLICY_PATHS.map((path) => path.slice(1)),
      ...PUBLIC_BUSINESS_PATHS.map((path) => path.slice(1)),
      ...PUBLIC_ECOSYSTEM_PATHS.map((path) => path.slice(1)),
      ...PUBLIC_FORM_PATHS.map((path) => path.slice(1)),
    ]),
  ].sort();
  return {
    routeTemplateCount: routeRows.length,
    uiRouteTemplateCount: routeRows.filter(({ route, file }) => isKovaUiRoute(route, file)).length,
    serviceRouteTemplateCount: routeRows.filter(({ route, file }) => !isKovaUiRoute(route, file))
      .length,
    routeTemplates: routeRows,
    publicIndexContentSlugCount: publicSlugs.length,
    publicIndexContentSlugs: publicSlugs,
    publicDetailPathCount: publicDetailPaths.length,
    publicDetailPaths,
    publicRegistryPageCount: publicSlugs.length + publicDetailPaths.length,
    reviewedPublicPathCount: PUBLIC_REVIEW_PATHS.length,
    reviewedPublicPaths: PUBLIC_REVIEW_PATHS,
    sitemapPathCount: PUBLIC_SITEMAP_ENTRIES.length,
    sitemapPaths: PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path),
  };
}

const [openai, chatgpt, kovagpt] = await Promise.all([
  collectOpenAi(),
  collectChatGpt(),
  collectKova(),
]);

const inventory = {
  schemaVersion: 1,
  snapshotDate: SNAPSHOT_DATE,
  scope: {
    definition:
      "Every discoverable public canonical page counts as one equally weighted item. ChatGPT marketing paths absent from its sitemap are included; private user data and non-page assets are not enumerable public pages.",
    adaptationRule:
      "KovaGPT implements original Kova-branded equivalents for relevant page families instead of copying third-party text, media, trademarks, or page-for-page editorial archives.",
  },
  openai,
  chatgpt,
  kovagpt,
};

const implementedKovaPaths = new Set([
  ...kovagpt.reviewedPublicPaths.map((path) => normalizePath(path)),
  ...kovagpt.routeTemplates
    .filter(
      ({ route, file }) =>
        isKovaUiRoute(route, file) && route.startsWith("/") && !route.includes("$"),
    )
    .map(({ route }) => normalizePath(route)),
]);
const chatgptSitemapByPath = new Map(
  chatgpt.urls.map((url) => [normalizePath(url, "https://chatgpt.com"), url]),
);
const chatgptPaths = new Set([
  ...chatgptSitemapByPath.keys(),
  ...chatgpt.marketingNavigation.paths.map((path) => normalizePath(path, "https://chatgpt.com")),
]);

function progressRecord(source, sourceUrl, sourcePath, sourceFamily, discovery) {
  const completed = implementedKovaPaths.has(sourcePath);
  return {
    source,
    sourceUrl,
    sourcePath,
    sourceFamily,
    discovery,
    weight: 1,
    kovaPath: completed ? sourcePath : null,
    status: completed ? "implemented_exact_path" : "missing_exact_equivalent",
    completed,
  };
}

const pageProgressRecords = [
  ...openai.urls.map((url) =>
    progressRecord("openai.com", url, normalizePath(url, "https://openai.com"), openAiFamily(url), [
      "sitemap",
    ]),
  ),
  ...[...chatgptPaths].sort().map((path) => {
    const sitemapUrl = chatgptSitemapByPath.get(path);
    const inMarketingNavigation = chatgpt.marketingNavigation.paths.some(
      (marketingPath) => normalizePath(marketingPath, "https://chatgpt.com") === path,
    );
    return progressRecord(
      "chatgpt.com",
      sitemapUrl ?? `https://chatgpt.com${path === "/" ? "" : path}`,
      path,
      chatGptFamily(sitemapUrl ?? `https://chatgpt.com${path}`),
      [sitemapUrl ? "sitemap" : null, inMarketingNavigation ? "marketing_navigation" : null].filter(
        Boolean,
      ),
    );
  }),
];
const completedPageCount = pageProgressRecords.filter(({ completed }) => completed).length;
const pageProgress = {
  schemaVersion: 1,
  snapshotDate: SNAPSHOT_DATE,
  measurement: {
    definition:
      "One discovered OpenAI or ChatGPT public page equals one unit. A unit is complete only when the same normalized path exists in KovaGPT's reviewed public routes or concrete UI route templates.",
    sourcePageCount: pageProgressRecords.length,
    completedPageCount,
    remainingPageCount: pageProgressRecords.length - completedPageCount,
    completionPercent: Number(((completedPageCount / pageProgressRecords.length) * 100).toFixed(2)),
    percentPerPage: Number((100 / pageProgressRecords.length).toFixed(6)),
    sourceCounts: counts(pageProgressRecords.map(({ source }) => source)),
  },
  records: pageProgressRecords,
};

await mkdir(dirname(OUTPUT), { recursive: true });
await Promise.all([
  writeFile(OUTPUT, `${JSON.stringify(inventory, null, 2)}\n`),
  writeFile(PAGE_PROGRESS_OUTPUT, `${JSON.stringify(pageProgress, null, 2)}\n`),
]);
console.log(
  `UI surface inventory: OpenAI ${openai.uniqueUrlCount} unique URLs; ChatGPT ${chatgpt.sitemapEntryCount} sitemap URLs + ${chatgpt.marketingNavigation.pathCount} marketing paths; KovaGPT ${kovagpt.uiRouteTemplateCount} UI templates + ${kovagpt.publicRegistryPageCount} public registry pages; strict linear page progress ${completedPageCount}/${pageProgressRecords.length}.`,
);
