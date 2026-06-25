import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

export const Route = createFileRoute("/code-helper")({
  head: () =>
    seoLandingHead({
      title: "AI Code Helper - KovaGPT",
      description:
        "Use KovaGPT to write, debug, explain, and improve code with focused AI help.",
      path: "/code-helper",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Code Helper"
      intro="KovaGPT can help with coding questions, debugging, explanations, website ideas, and code improvement."
      benefits={[
        "Debug errors faster",
        "Understand code line by line",
        "Generate starter code",
        "Improve and clean up existing code",
      ]}
      prompts={[
        "Fix this code error",
        "Explain what this function does",
        "Make this component cleaner",
        "Help me build a simple website section",
      ]}
      ctas={[
        { label: "Start Coding", to: "/" },
        { label: "View Modes", to: "/modes" },
      ]}
    />
  );
}
