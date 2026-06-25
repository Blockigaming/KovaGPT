import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

export const Route = createFileRoute("/study-assistant")({
  head: () =>
    seoLandingHead({
      title: "AI Study Assistant - KovaGPT",
      description:
        "Use KovaGPT as an AI study assistant for explanations, practice questions, summaries, and learning help.",
      path: "/study-assistant",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Study Assistant"
      intro="KovaGPT can help you understand topics, study smarter, create practice questions, summarize notes, and learn step by step."
      benefits={[
        "Get step-by-step explanations",
        "Turn notes into summaries",
        "Create quizzes and practice questions",
        "Study with focused AI modes",
      ]}
      prompts={[
        "Explain this topic step by step",
        "Make me a practice quiz",
        "Summarize these notes",
        "Help me make a study plan",
      ]}
      ctas={[
        { label: "Start Studying", to: "/" },
        { label: "View Modes", to: "/modes" },
      ]}
    />
  );
}
