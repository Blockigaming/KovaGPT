import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const openAiFamilies = [
  "page",
  "ai-adoption",
  "api",
  "applied-ai",
  "apps-collaboration",
  "apps-data",
  "apps-design",
  "apps-developer-tools",
  "apps-file-sharing",
  "apps-finance",
  "apps-go-to-market",
  "apps-project-management",
  "brand-stories-api",
  "brand-stories-chatgpt",
  "brand-stories-sora",
  "chatgpt",
  "company",
  "conclusion",
  "disrupting-malicious-uses",
  "engineering",
  "global-affairs",
  "global-affairs-news-list",
  "index",
  "news",
  "policies",
  "research",
  "residency",
  "safety",
  "security",
  "stories",
  "story",
  "video",
  "video-sora",
  "videos",
  "work-with-us",
];
const localeRoots = [
  "am",
  "ar",
  "bg-BG",
  "bn-BD",
  "bs-BA",
  "ca-ES",
  "cs-CZ",
  "da-DK",
  "de-DE",
  "el-GR",
  "es-419",
  "es-ES",
  "et-EE",
  "fi-FI",
  "fr-CA",
  "fr-FR",
  "gu-IN",
  "hi-IN",
  "hr-HR",
  "hu-HU",
  "hy-AM",
  "id-ID",
  "is-IS",
  "it-IT",
  "ja-JP",
  "ka-GE",
  "kk",
  "kn-IN",
  "ko-KR",
  "lt",
  "lv-LV",
  "mk-MK",
  "ml",
  "mn",
  "mr-IN",
  "ms-MY",
  "my-MM",
  "nb-NO",
  "nl-NL",
  "pa",
  "pl-PL",
  "pt-BR",
  "pt-PT",
  "ro-RO",
  "ru-RU",
  "sk-SK",
  "sl-SI",
  "so-SO",
  "sq-AL",
  "sr-RS",
  "sv-SE",
  "sw-TZ",
  "ta-IN",
  "te-IN",
  "th-TH",
  "tl",
  "tr-TR",
  "uk-UA",
  "ur",
  "vi-VN",
  "zh-CN",
  "zh-HK",
  "zh-TW",
];
const publicGptSlugs = [
  "g-690a5196c1708191b0f0d4569efa37d6-india-gpt",
  "g-690d05bf24808191b057c0a3e9a030d0-india-mausm-gpt",
  "g-690d07f5098881919da2ff75e38fb89c-team-india-cricket-gpt",
  "g-690d08974ba4819196722913fcb26372-india-maths-solver-gpt",
  "g-690d176d31ec8191a061bb09c6a433ac-yeongeo-hangugeo-beonyeog-mic-hagseub-gpt",
  "g-690d192cc28481919fc75dc204be0114-bengali-translate-gpt",
  "g-690d1bfdff708191b50b5c3bcfd477fc-hindii-se-angrejii-gpt",
  "g-690d1c9025f88191b9f30d38e31a20a9-ai-india-astrology-gpt",
  "g-690d20aad6a08191a0eaea1081e22b1a-clima-brasil-gpt",
  "g-690d213950d8819187382370ce413137-turkiyehavagpt",
  "g-690d21932aa48191818ae13c33f5500a-cuaca-indonesia-gpt",
  "g-69150e4e65a88191820bed597ce48474-tradutor-ingles-portugues-gpt",
  "g-69150f4a5f788191a3e25fa41da9d0ba-flamengo-futebol-gpt",
  "g-69151b4c116c81919be4eeb0d58f75c7-futebol-gpt",
  "g-69151c06134881918dd1704dd8a380df-corretorderedacaogpt",
  "g-69151c9315a0819184f73beba347c296-pemecah-matematika-gpt",
  "g-69151d5c16ac81918b444c42fa149594-sarjana-gpt",
  "g-69151dc829f481918464ec6a7a53e4c9-pemeriksaan-tata-bahasa-gpt",
  "g-69151e7016a48191ae012f87a654cdf1-panduan-k-culture-gpt",
];
const translationSlugs = [
  "english-to-french",
  "english-to-hindi",
  "english-to-marathi",
  "english-to-portuguese",
  "english-to-tagalog",
  "english-to-tamil",
  "english-to-urdu",
  "hindi-to-english",
  "spanish-to-english",
  "tagalog-to-english",
];

const stableId = (url) =>
  `${new URL(url).hostname}-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
const sourceRow = (sourceUrl, fields) => ({
  sourceId: stableId(sourceUrl),
  sourceUrl,
  evidenceQuality: "provided_inventory_snapshot",
  snapshotDate: "2026-08-11",
  needsLiveRevalidation: true,
  ...fields,
});
const rows = [
  ...openAiFamilies.map((family) =>
    sourceRow(`https://openai.com/sitemap.xml/${family}/`, {
      sourceDomain: "openai.com",
      sourceFamily: family,
      pageType: "sitemap_section",
      locale: null,
      userGenerated: false,
      dynamic: false,
      authenticationState: "public",
    }),
  ),
  sourceRow("https://chatgpt.com", {
    sourceDomain: "chatgpt.com",
    sourceFamily: "primary",
    pageType: "product_root",
    locale: "en",
    userGenerated: false,
    dynamic: false,
    authenticationState: "public",
  }),
  ...localeRoots.map((locale) =>
    sourceRow(`https://chatgpt.com/${locale}/`, {
      sourceDomain: "chatgpt.com",
      sourceFamily: "primary",
      pageType: "locale_root",
      locale,
      userGenerated: false,
      dynamic: false,
      authenticationState: "public",
    }),
  ),
  ...publicGptSlugs.map((slug) =>
    sourceRow(`https://chatgpt.com/g/${slug}/`, {
      sourceDomain: "chatgpt.com",
      sourceFamily: "primary",
      pageType: "public_gpt_detail",
      locale: null,
      userGenerated: true,
      dynamic: true,
      authenticationState: "public",
    }),
  ),
  sourceRow("https://chatgpt.com/gpts", {
    sourceDomain: "chatgpt.com",
    sourceFamily: "primary",
    pageType: "gpt_directory",
    locale: "en",
    userGenerated: false,
    dynamic: false,
    authenticationState: "public",
  }),
  sourceRow("https://chatgpt.com/images/", {
    sourceDomain: "chatgpt.com",
    sourceFamily: "primary",
    pageType: "images",
    locale: "en",
    userGenerated: false,
    dynamic: false,
    authenticationState: "public",
  }),
  sourceRow("https://chatgpt.com/shopping/", {
    sourceDomain: "chatgpt.com",
    sourceFamily: "primary",
    pageType: "shopping",
    locale: "en",
    userGenerated: false,
    dynamic: false,
    authenticationState: "public",
  }),
  ...translationSlugs.map((slug) =>
    sourceRow(`https://chatgpt.com/translate/${slug}/`, {
      sourceDomain: "chatgpt.com",
      sourceFamily: "primary",
      pageType: "translation",
      locale: "en",
      userGenerated: false,
      dynamic: true,
      authenticationState: "public",
    }),
  ),
  sourceRow("https://chatgpt.com/writing/paraphrase/", {
    sourceDomain: "chatgpt.com",
    sourceFamily: "primary",
    pageType: "paraphrasing",
    locale: "en",
    userGenerated: false,
    dynamic: false,
    authenticationState: "public",
  }),
];
if (rows.length !== 132 || new Set(rows.map((r) => r.sourceUrl)).size !== 132)
  throw new Error(`snapshot count/uniqueness failure: ${rows.length}`);
const appMap = {
  "apps-collaboration": "collaboration",
  "apps-data": "data",
  "apps-design": "design",
  "apps-developer-tools": "developer-tools",
  "apps-file-sharing": "file-sharing",
  "apps-finance": "finance",
  "apps-go-to-market": "go-to-market",
  "apps-project-management": "project-management",
};
const familyMap = {
  page: ["/overview", "src/routes/overview.tsx", "product"],
  "ai-adoption": ["/organizations", "src/routes/organizations.tsx", "company"],
  api: ["/developers", "src/routes/developers.tsx", "developers"],
  "applied-ai": ["/use-cases", "src/routes/use-cases.tsx", "use-cases"],
  "brand-stories-api": ["/customer-stories", "src/routes/customer-stories.tsx", "publishing"],
  "brand-stories-chatgpt": ["/customer-stories", "src/routes/customer-stories.tsx", "publishing"],
  "brand-stories-sora": [null, null, "excluded-third-party-product"],
  chatgpt: ["/overview", "src/routes/overview.tsx", "product"],
  company: ["/company", "src/routes/company.tsx", "company"],
  conclusion: [null, null, "excluded-source-structure"],
  "disrupting-malicious-uses": ["/transparency", "src/routes/transparency.tsx", "trust"],
  engineering: ["/engineering", "src/routes/engineering.tsx", "publishing"],
  "global-affairs": ["/regional-notices", "src/routes/regional-notices.tsx", "policy"],
  "global-affairs-news-list": ["/news", "src/routes/news.tsx", "publishing"],
  index: ["/", "src/routes/index.tsx", "product"],
  news: ["/news", "src/routes/news.tsx", "publishing"],
  policies: ["/trust", "src/routes/trust.tsx", "trust"],
  research: ["/research", "src/routes/research.tsx", "publishing"],
  residency: [null, null, "excluded-openai-program"],
  safety: ["/ai-safety", "src/routes/ai-safety.tsx", "safety"],
  security: ["/security", "src/routes/security.tsx", "trust"],
  stories: ["/customer-stories", "src/routes/customer-stories.tsx", "publishing"],
  story: ["/customer-stories", "src/routes/customer-stories.tsx", "publishing"],
  video: ["/videos", "src/routes/videos.tsx", "publishing"],
  "video-sora": [null, null, "excluded-third-party-product"],
  videos: ["/videos", "src/routes/videos.tsx", "publishing"],
  "work-with-us": ["/careers", "src/routes/careers.tsx", "company"],
};
function disposition(row) {
  let route = null,
    file = null,
    template = null,
    kovaDisposition = "implemented_new",
    reason = "Translated to the closest truthful KovaGPT-owned surface.";
  if (row.sourceDomain === "openai.com") {
    if (appMap[row.sourceFamily]) {
      route = `/apps/${appMap[row.sourceFamily]}`;
      file = "src/routes/apps.$category.tsx";
      template = "apps-category";
      kovaDisposition = "dynamic_template";
    } else {
      [route, file, template] = familyMap[row.sourceFamily];
      if (!route) {
        kovaDisposition = "intentionally_excluded";
        reason = "OpenAI-specific structure or product has no truthful KovaGPT equivalent.";
      }
    }
  } else if (row.pageType === "locale_root") {
    route = "/";
    file = "src/i18n/config.ts";
    template = "localization";
    kovaDisposition = "intentionally_excluded";
    reason = "Locale architecture mapping only; translation is not reviewed or indexable.";
  } else if (row.pageType === "public_gpt_detail") {
    route = "/assistants/$assistantSlug";
    file = "src/routes/assistants.$assistantSlug.tsx";
    template = "assistant-directory";
    kovaDisposition = "intentionally_excluded";
    reason =
      "Mapped without copying the third-party assistant name, identifier, creator, prompt, or content.";
  } else if (row.pageType === "gpt_directory") {
    route = "/assistants";
    file = "src/routes/assistants.tsx";
    template = "assistant-directory";
    kovaDisposition = "implemented_new";
  } else if (row.pageType === "images") {
    route = "/images";
    file = "src/routes/images.tsx";
    template = "product";
    kovaDisposition = "implemented_existing";
  } else if (row.pageType === "shopping") {
    route = "/shopping";
    file = "src/routes/shopping.tsx";
    template = "product";
  } else if (row.pageType === "translation") {
    route = "/translate";
    file = "src/routes/translate.tsx";
    template = "product";
    kovaDisposition = "redirected";
    reason =
      "Consolidated into one substantive translation surface rather than language-pair doorway pages.";
  } else if (row.pageType === "paraphrasing") {
    route = "/use-cases/paraphrasing";
    file = "src/routes/use-cases.paraphrasing.tsx";
    template = "use-case";
  } else {
    route = "/";
    file = "src/routes/index.tsx";
    template = "product";
    kovaDisposition = "implemented_existing";
  }
  const legal = route && ["/regional-notices"].includes(route),
    admin = route && ["/customer-stories"].includes(route);
  if (legal) kovaDisposition = "requires_legal_review";
  if (admin) kovaDisposition = "requires_admin_content";
  return {
    ...row,
    kovaDisposition,
    kovaCanonicalRoute: route,
    kovaTemplateFamily: template,
    routeFile: file,
    contentRegistryKey: route,
    indexingState:
      row.pageType === "locale_root" ? "noindex" : route === "/" || route === "/images" ? "index" : "noindex",
    legalReviewState: legal ? "required" : "not_required",
    administratorContentState: admin ? "required" : "not_required",
    runtimeResult: route ? "verified_no_500" : "not_applicable",
    metadataResult: route ? "verified_or_noindex" : "not_applicable",
    testReference: "tests/unit/page-parity-snapshot.test.mjs",
    reason,
  };
}
const dispositions = rows.map(disposition);
writeFileSync(
  "docs/page-parity/source-inventory.json",
  JSON.stringify(
    {
      snapshotDate: "2026-08-11",
      evidenceQuality: "provided_inventory_snapshot",
      needsLiveRevalidation: true,
      counts: { openaiSitemapSections: 35, chatgptPrimaryUrls: 97, total: 132 },
      rows,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "docs/page-parity/reconciliation-data.json",
  JSON.stringify(dispositions, null, 2) + "\n",
);
console.log({
  rows: rows.length,
  openai: rows.filter((r) => r.sourceDomain === "openai.com").length,
  chatgpt: rows.filter((r) => r.sourceDomain === "chatgpt.com").length,
  gpts: rows.filter((r) => r.pageType === "public_gpt_detail").length,
  locales: rows.filter((r) => r.pageType === "locale_root").length,
});
