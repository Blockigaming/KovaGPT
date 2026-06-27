import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

export const Route = createFileRoute("/ai-humanizer")({
  head: () =>
    seoLandingHead({
      title: "AI Humanizer - Humanize AI Text with KovaGPT",
      description:
        "Humanize AI-generated text with KovaGPT. Rewrite stiff, robotic AI output into natural, human-sounding writing that reads clearly and passes AI detection.",
      path: "/ai-humanizer",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Humanizer: Make AI Text Sound Human"
      intro="KovaGPT can rewrite AI-generated drafts so they sound natural, conversational, and clearly written by a person. Paste any AI output and ask KovaGPT to humanize it: vary sentence length, drop generic phrasing, add specifics, and match your own voice. Useful for emails, essays, blog posts, social captions, and anything that currently reads stiff or robotic."
      benefits={[
        "Rewrite AI text in a natural, human tone",
        "Vary sentence length and rhythm so it reads like you wrote it",
        "Remove generic AI phrasing and filler words",
        "Match a specific voice: casual, professional, academic, friendly",
        "Refine output to pass common AI detection patterns",
      ]}
      prompts={[
        "Humanize this paragraph and make it sound like I wrote it",
        "Rewrite this in a casual, conversational tone",
        "Make this AI text less robotic and more natural",
        "Edit this so it reads like a real person, not a chatbot",
      ]}
      ctas={[
        { label: "Humanize Text Now", to: "/" },
        { label: "View Pricing", to: "/pricing" },
      ]}
    />
  );
}
