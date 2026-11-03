import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { PUBLIC_SITEMAP_ENTRIES } from "@/lib/seo-policy.mjs";
import { PUBLIC_WEBSITE_INDEXABLE_PATHS } from "@/lib/public-website-catalog.mjs";

const BASE_URL = "https://kovagpt.com";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const existing = new Set(PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path));
        const entries = [
          ...PUBLIC_SITEMAP_ENTRIES,
          ...PUBLIC_WEBSITE_INDEXABLE_PATHS.filter((path) => !existing.has(path)).map((path) => ({
            path,
            changefreq: "monthly",
            priority: "0.5",
          })),
        ];
        const urls = entries.map((entry) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${entry.path}</loc>`,
            `    <changefreq>${entry.changefreq}</changefreq>`,
            `    <priority>${entry.priority}</priority>`,
            `  </url>`,
          ].join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
            "X-Robots-Tag": "noindex, follow",
          },
        });
      },
    },
  },
});
