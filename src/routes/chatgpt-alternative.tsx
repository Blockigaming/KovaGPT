import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

export const Route = createFileRoute("/chatgpt-alternative")({
  head: () =>
    seoLandingHead({
      title: "ChatGPT Alternative - KovaGPT",
      description:
        "Explore KovaGPT, an AI chatbot with focused modes for writing, study, coding, research, images, and everyday work.",
      path: "/chatgpt-alternative",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="ChatGPT Alternative"
      intro="KovaGPT is an AI chatbot built around focused modes, so users can choose the kind of help they need for writing, studying, coding, research, images, and everyday tasks."
      benefits={[
        "Focused modes for different tasks",
        "Image generation tools",
        "File upload support when available",
        "Saved chats when signed in",
        "Clear pricing and support pages",
      ]}
      prompts={[
        "Help me study this topic",
        "Write a better email",
        "Fix this code",
        "Generate an image prompt",
        "Summarize a file",
      ]}
      ctas={[
        { label: "Try KovaGPT", to: "/" },
        { label: "View Pricing", to: "/pricing" },
        { label: "View Modes", to: "/modes" },
      ]}
    />
  );
}
