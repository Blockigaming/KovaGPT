import type { SeoFaq } from "./SeoLanding";
export function seoLandingHead(opts: {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  faq?: SeoFaq[];
}) {
  const url = `https://kovagpt.com${opts.path}`;
  const ogImage = opts.ogImage
    ? opts.ogImage.startsWith("http")
      ? opts.ogImage
      : `https://kovagpt.com${opts.ogImage}`
    : "https://kovagpt.com/og/home.jpg";
  const scripts: { type: string; children: string }[] = [
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: opts.title,
        description: opts.description,
        url,
        image: ogImage,
      }),
    },
  ];
  if (opts.faq && opts.faq.length > 0) {
    scripts.push({
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: opts.faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }),
    });
  }
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { property: "og:image", content: ogImage },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: opts.title },
      { name: "twitter:description", content: opts.description },
      { name: "twitter:image", content: ogImage },
    ],
    links: [{ rel: "canonical", href: url }],
    scripts,
  };
}
