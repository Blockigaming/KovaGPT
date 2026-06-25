import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

export const Route = createFileRoute("/ai-writer")({
  head: () =>
    seoLandingHead({
      title: "AI Writer - KovaGPT",
      description:
        "Use KovaGPT to write and improve emails, essays, posts, scripts, captions, and professional writing.",
      path: "/ai-writer",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Writer"
      intro="KovaGPT helps you write clearer, faster, and more polished content for school, work, websites, and creative projects."
      benefits={[
        "Improve emails and messages",
        "Draft essays, posts, and scripts",
        "Rewrite text in a better tone",
        "Brainstorm titles, captions, and ideas",
      ]}
      prompts={[
        "Make this email sound more professional",
        "Rewrite this paragraph clearly",
        "Give me ideas for a blog post",
        "Turn these notes into a draft",
      ]}
      ctas={[
        { label: "Start Writing", to: "/" },
        { label: "View Pricing", to: "/pricing" },
      ]}
    />
  );
}
