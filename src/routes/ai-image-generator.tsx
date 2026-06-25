import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

export const Route = createFileRoute("/ai-image-generator")({
  head: () =>
    seoLandingHead({
      title: "AI Image Generator - KovaGPT",
      description:
        "Create images from text prompts with KovaGPT. Explore styles, prompt ideas, and AI image generation tools.",
      path: "/ai-image-generator",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Image Generator"
      intro="KovaGPT helps you turn text prompts into images for ideas, avatars, wallpapers, social posts, website graphics, and creative projects."
      benefits={[
        "Generate images from text prompts",
        "Try creative styles and visual ideas",
        "Make graphics for posts, websites, and projects",
        "Use KovaGPT to improve your prompts",
      ]}
      prompts={[
        "Create a realistic product photo on a clean background",
        "Generate a gaming avatar with a futuristic style",
        "Make a cyberpunk city wallpaper",
        "Create a logo idea for a small business",
      ]}
      ctas={[
        { label: "Generate Images", to: "/images" },
        { label: "View Pricing", to: "/pricing" },
      ]}
    />
  );
}
