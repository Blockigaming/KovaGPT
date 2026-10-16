import { createFileRoute } from "@tanstack/react-router";

// The root mounts one lazy assistant across home and saved-conversation URLs.
export const Route = createFileRoute("/")({
  component: () => null,
  head: () => ({
    meta: [
      { title: "KovaGPT" },
      {
        name: "description",
        content:
          "KovaGPT - a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { property: "og:title", content: "KovaGPT" },
      {
        property: "og:description",
        content:
          "KovaGPT - a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { property: "og:url", content: "https://kovagpt.com/" },
      { property: "og:image", content: "https://kovagpt.com/og/home.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KovaGPT" },
      {
        name: "twitter:description",
        content:
          "KovaGPT - a multimodal AI assistant for chat, code, research, and image generation.",
      },
      { name: "twitter:image", content: "https://kovagpt.com/og/home.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/" }],
  }),
});
