import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://kovagpt.com";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/images", changefreq: "weekly", priority: "0.8" },
          { path: "/pricing", changefreq: "monthly", priority: "0.8" },
          { path: "/modes", changefreq: "monthly", priority: "0.6" },
          { path: "/changelog", changefreq: "monthly", priority: "0.4" },
          { path: "/status", changefreq: "weekly", priority: "0.3" },
          { path: "/blog/best-ai-assistants", changefreq: "monthly", priority: "0.7" },
          { path: "/blog/ai-market-research-guide", changefreq: "monthly", priority: "0.7" },
          { path: "/blog/best-ai-market-research-tools", changefreq: "monthly", priority: "0.7" },
          { path: "/checkout/return", changefreq: "yearly", priority: "0.2" },
          { path: "/privacy", changefreq: "yearly", priority: "0.3" },
          { path: "/terms", changefreq: "yearly", priority: "0.3" },
          { path: "/refund", changefreq: "yearly", priority: "0.3" },
          { path: "/ai-safety", changefreq: "yearly", priority: "0.3" },
          { path: "/contact-support", changefreq: "yearly", priority: "0.4" },
          { path: "/getting-started", changefreq: "monthly", priority: "0.5" },
          { path: "/ai-image-generator", changefreq: "monthly", priority: "0.7" },
          { path: "/study-assistant", changefreq: "monthly", priority: "0.7" },
          { path: "/code-helper", changefreq: "monthly", priority: "0.7" },
          { path: "/ai-writer", changefreq: "monthly", priority: "0.7" },
          { path: "/research-assistant", changefreq: "monthly", priority: "0.7" },
          { path: "/chatgpt-alternative", changefreq: "monthly", priority: "0.7" },
          { path: "/ai-humanizer", changefreq: "monthly", priority: "0.7" },
          { path: "/apps", changefreq: "monthly", priority: "0.5" },
          { path: "/library", changefreq: "monthly", priority: "0.4" },
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
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
          },
        });
      },
    },
  },
});
