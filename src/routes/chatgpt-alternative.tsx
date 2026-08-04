import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "Is KovaGPT affiliated with OpenAI or ChatGPT?",
    a: "No. KovaGPT is an independently developed and branded product. It is not affiliated with, endorsed by, or sponsored by OpenAI. ChatGPT is a trademark of OpenAI.",
  },
  {
    q: "What can I use KovaGPT for?",
    a: "KovaGPT offers focused experiences for chat, writing, study, coding, research, and image tasks. The tools and limits available to you are shown in the product and can vary by account or configuration.",
  },
  {
    q: "Can I try KovaGPT before choosing a paid plan?",
    a: "Open KovaGPT to see the access currently available to your account. The pricing page and in-product usage displays are the source of truth for current plans and limits.",
  },
  {
    q: "How are connected apps handled?",
    a: "Connected-app capabilities appear only after an integration is enabled. KovaGPT asks for confirmation before supported consequential actions, and exact capabilities depend on the provider and account configuration.",
  },
  {
    q: "Where can I review KovaGPT's privacy terms?",
    a: "The Privacy page describes current data-handling terms. In-product controls show the deletion and account options that are actually available to you.",
  },
];

export const Route = createFileRoute("/chatgpt-alternative")({
  head: () =>
    seoLandingHead({
      title: "KovaGPT | Independent AI Workspace",
      description:
        "KovaGPT is an independent AI workspace with focused experiences for chat, writing, study, coding, research, and images. Availability varies by account.",
      path: "/chatgpt-alternative",
      ogImage: "/og/home.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="KovaGPT, built for focused AI work"
      intro="KovaGPT is an independent AI workspace for chat, writing, study, code, research, and images. Choose a focused experience and use the tools available to your account. KovaGPT is not affiliated with or endorsed by OpenAI."
      benefits={[
        "Focused experiences for writing, study, coding, research, and image tasks",
        "Project and conversation organization",
        "File context where uploads are available",
        "Optional connected apps when configured",
        "Confirmation steps for supported consequential actions",
        "Account-specific settings, plan information, and usage limits",
      ]}
      details={[
        "KovaGPT is developed and branded as its own product. Third-party names on this comparison page identify products people may be comparing; they do not imply sponsorship, endorsement, or affiliation.",
        "Capabilities can vary by plan, region, connected provider, and account configuration. The live product, pricing page, and in-product usage displays show what is available to a particular account.",
      ]}
      prompts={[
        "Turn these notes into a concise outline",
        "Explain this concept step by step",
        "Review this function for likely bugs",
        "Summarize this document and list open questions",
        "Create an image prompt for a product illustration",
      ]}
      ctas={[
        { label: "Open KovaGPT", to: "/" },
        { label: "Review Pricing", to: "/pricing" },
        { label: "Explore Modes", to: "/modes" },
      ]}
      faq={faq}
    />
  );
}
