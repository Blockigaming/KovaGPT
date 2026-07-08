import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

const faq = [
  {
    q: "Can I use the images commercially?",
    a: "Yes. Images generated on paid plans are yours to use in commercial projects — websites, marketing, products, social media, and print.",
  },
  {
    q: "What styles can KovaGPT generate?",
    a: "Photorealistic, illustration, 3D render, anime, watercolor, oil painting, product photography, cinematic, isometric, pixel art, logo mark, minimalist — describe the style and KovaGPT delivers.",
  },
  {
    q: "Can I generate transparent PNGs or logos?",
    a: "Yes. Ask for a transparent background and KovaGPT produces PNGs suitable for logos, icons, stickers, and overlays.",
  },
  {
    q: "How fast is it?",
    a: "Images generate in seconds — usually 5 to 15 depending on complexity and current load.",
  },
];

export const Route = createFileRoute("/ai-image-generator")({
  head: () =>
    seoLandingHead({
      title: "AI Image Generator — Text to Image in Seconds | KovaGPT",
      description:
        "Generate high-quality images from text prompts with KovaGPT. Photorealistic, illustration, 3D, product shots, logos — commercial-safe, fast, and easy to iterate.",
      path: "/ai-image-generator",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Image Generator: Text to Image in Seconds"
      intro="Describe what you want and KovaGPT delivers a finished image — product shots, avatars, wallpapers, illustrations, marketing graphics, logos, storyboards. Iterate in natural language: change the style, swap the background, adjust the lighting, no design software required."
      benefits={[
        "Photorealistic, illustration, 3D render, anime, or minimalist styles",
        "Transparent PNGs for logos, icons, and stickers",
        "Iterate in plain English — 'make it warmer', 'change the background to a beach'",
        "Commercial-use rights on paid plans",
        "Save every image to your personal library",
        "Prompt help built in — KovaGPT can improve your prompt for you",
      ]}
      details={[
        "Traditional image tools ask you to master a UI. KovaGPT asks you to describe what you want. Say 'a matte-black wireless earbud on a cream studio background, soft rim light, 45-degree angle' and you get exactly that — then refine it with follow-up prompts instead of restarting.",
        "It's the fastest way to produce visuals for social posts, landing pages, product mockups, blog headers, avatars, and brand assets. Everything you generate lands in your library, so you can revisit, reuse, and remix.",
      ]}
      prompts={[
        "A minimalist logo mark for a coffee brand called Ember, transparent background",
        "Photorealistic product shot of a leather notebook on a wooden desk, morning light",
        "Cyberpunk cityscape at night, neon reflections, cinematic 21:9",
        "Cute mascot for a productivity app: a friendly fox holding a checklist",
        "Watercolor illustration of a mountain range for a blog header",
      ]}
      ctas={[
        { label: "Generate an Image", to: "/images" },
        { label: "See Pricing", to: "/pricing" },
      ]}
      faq={faq}
    />
  );
}
