import { createContentLoader } from "./source-loader.mjs";

const families = [
  ["public-content", "PUBLIC_PAGES", "landing"],
  ["public-content-expanded", "EXPANDED_PUBLIC_PAGES", "landing"],
  ["public-detail-content", "PUBLIC_DETAIL_PAGES", "detail"],
  ["public-academy-content", "PUBLIC_ACADEMY_PAGES", "detail"],
  ["public-business-content", "PUBLIC_BUSINESS_PAGES", "detail"],
  ["public-ecosystem-content", "PUBLIC_ECOSYSTEM_PAGES", "detail"],
  ["public-form-content", "PUBLIC_FORM_PAGES", "detail"],
  ["public-global-affairs-content", "PUBLIC_GLOBAL_AFFAIRS_PAGES", "detail"],
  ["public-policy-content", "PUBLIC_POLICY_PAGES", "detail"],
  ["public-solution-content", "PUBLIC_SOLUTION_PAGES", "detail"],
];

export function readPublicCatalog(root = process.cwd()) {
  const { load, sources } = createContentLoader(root);
  const policy = load("src/lib/seo-policy.mjs");
  const records = [];
  for (const [module, key, template] of families) {
    const source = `src/lib/${module}.ts`;
    for (const item of load(source)[key]) {
      const path = item.section ? `/${item.section}/${item.slug}` : `/${item.slug}`;
      // Preserve source content; do not silently synthesize missing descriptions,
      // sections, approvals, or capabilities and then count them as complete.
      records.push({ ...item, path, template, source });
    }
  }
  const registry = load("src/lib/capability-registry.ts").CAPABILITY_REGISTRY;
  return {
    records,
    reviewPaths: Array.from(policy.PUBLIC_REVIEW_PATHS),
    sitemapPaths: Array.from(policy.PUBLIC_SITEMAP_ENTRIES, (entry) => entry.path),
    registry,
    sources: Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b))),
  };
}
