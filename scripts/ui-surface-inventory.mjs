import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_REVIEW_PATHS, PUBLIC_SITEMAP_ENTRIES } from "../src/lib/seo-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "docs/ui-ux/live-surface-inventory.json");
const SNAPSHOT_DATE =
  process.env.KOVA_UI_SNAPSHOT_DATE?.trim() || new Date().toISOString().slice(0, 10);

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
      evidence: `Live authenticated navigation inspected read-only on ${SNAPSHOT_DATE}.`,
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
    route === "/sitemap.xml"
  );
}

async function collectKova() {
  const routeFiles = (await walk(resolve(ROOT, "src/routes"))).filter((file) =>
    /\.tsx?$/u.test(file),
  );
  const routeRows = [];
  for (const file of routeFiles) {
    const source = await readFile(file, "utf8");
    const match = source.match(/createFileRoute\("([^"]+)"\)/u);
    if (!match) continue;
    routeRows.push({ route: match[1], file: relative(ROOT, file) });
  }
  routeRows.sort((left, right) => left.route.localeCompare(right.route));
  const publicContent = await readFile(resolve(ROOT, "src/lib/public-content.ts"), "utf8");
  const publicSlugs = [...publicContent.matchAll(/\bpage\(\s*"([^"]+)"/gu)]
    .map((match) => match[1])
    .sort();
  return {
    routeTemplateCount: routeRows.length,
    uiRouteTemplateCount: routeRows.filter(({ route, file }) => isKovaUiRoute(route, file)).length,
    serviceRouteTemplateCount: routeRows.filter(({ route, file }) => !isKovaUiRoute(route, file))
      .length,
    routeTemplates: routeRows,
    publicContentSlugCount: publicSlugs.length,
    publicContentSlugs: publicSlugs,
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
      "Every discoverable canonical page and reusable route template; excludes private instances, user-generated IDs, localized duplicates, assets, API endpoints, and verbatim replication.",
    adaptationRule:
      "KovaGPT implements original Kova-branded equivalents for relevant page families instead of copying third-party text, media, trademarks, or page-for-page editorial archives.",
  },
  openai,
  chatgpt,
  kovagpt,
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(
  `UI surface inventory: OpenAI ${openai.uniqueUrlCount} unique URLs; ChatGPT ${chatgpt.sitemapEntryCount} sitemap URLs + ${chatgpt.marketingNavigation.pathCount} marketing paths; KovaGPT ${kovagpt.uiRouteTemplateCount} UI templates + ${kovagpt.publicContentSlugCount} public registry pages.`,
);
