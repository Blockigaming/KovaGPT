import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "Can I use the images commercially?",
    a: "KovaGPT does not guarantee that an output is clear of third-party rights or suitable for a particular commercial use. Review the Terms, the applicable provider terms, and the output itself; get legal advice when rights matter.",
  },
  {
    q: "What styles can KovaGPT generate?",
    a: "You can request photographic, illustrated, 3D, watercolor, pixel-art, minimalist, and other looks. The configured image provider decides the result and may not follow every style instruction exactly.",
  },
  {
    q: "Can I generate transparent PNGs or logos?",
    a: "The current Images page does not expose output-format or transparency controls. You can describe a transparent background in the prompt, but the provider may render it as visible pixels rather than true alpha transparency. Inspect the downloaded file before using it as a logo or production asset.",
  },
  {
    q: "How fast is it?",
    a: "Generation time varies with provider load, settings, and network conditions. A request can time out or fail, so KovaGPT does not promise a fixed completion time.",
  },
];

export const Route = createFileRoute("/ai-image-generator")({
  head: () =>
    seoLandingHead({
      title: "AI Image Generator - Text to Image | KovaGPT",
      description:
        "Request AI-generated images from text prompts with KovaGPT, choose from prompt presets, and save selected results when the image provider is available.",
      path: "/ai-image-generator",
      ogImage: "/og/images.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Image Generator: Text to Image"
      intro="Describe the image you want and KovaGPT sends the request to the configured image provider. You can use a prompt preset, download a result, or save a selected image to Library. Availability and output quality depend on your account, quota, and the provider."
      benefits={[
        "Request photographic, illustrated, 3D, watercolor, pixel-art, or minimalist looks",
        "Use prompt presets as a starting point",
        "Submit one text prompt per request using the current provider defaults",
        "Create a new variation by reusing or changing the prompt",
        "Download results or save selected images to Library",
        "See an error message when quota or provider availability blocks a request",
      ]}
      details={[
        "Describe the subject, composition, lighting, palette, and intended format. More specific prompts can make intent clearer, but the provider can still omit or reinterpret details.",
        "A generated variation is a new provider request. The current endpoint does not guarantee pixel-level editing of the original image. Save or download a result you want to keep, and review rights, accuracy, and suitability before publishing it.",
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
