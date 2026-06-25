import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

export const Route = createFileRoute("/research-assistant")({
  head: () =>
    seoLandingHead({
      title: "AI Research Assistant - KovaGPT",
      description:
        "Use KovaGPT to organize research, compare ideas, summarize information, and create structured notes.",
      path: "/research-assistant",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Research Assistant"
      intro="KovaGPT can help organize research, summarize information, compare options, and turn messy notes into clear structure."
      benefits={[
        "Organize topics into clear sections",
        "Summarize long information",
        "Compare ideas and options",
        "Create outlines and research notes",
      ]}
      prompts={[
        "Research this topic and organize the main points",
        "Compare these two options",
        "Turn this into a research outline",
        "Summarize this information clearly",
      ]}
      ctas={[
        { label: "Start Researching", to: "/" },
        { label: "View Modes", to: "/modes" },
      ]}
    />
  );
}
