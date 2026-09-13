import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "Will it sound like me or like AI?",
    a: "Writing samples and tone instructions can guide a draft in the current conversation, but an exact voice match is not guaranteed. Review and revise important writing before you use it.",
  },
  {
    q: "Can it write long-form pieces?",
    a: "Yes. KovaGPT handles blog posts, essays, scripts, newsletters, and reports. For very long pieces, it can outline first, then draft section by section so you can steer as it goes.",
  },
  {
    q: "Can it help me edit instead of writing from scratch?",
    a: "Absolutely. Paste your draft and ask KovaGPT to tighten it, change the tone, cut length by 30%, fix grammar, or rewrite in a specific style. It keeps your ideas and just improves the delivery.",
  },
  {
    q: "Does it handle non-English writing?",
    a: "KovaGPT can help draft, edit, and translate many languages. Quality varies by language and context, so review translations where precise meaning matters.",
  },
];

export const Route = createFileRoute("/ai-writer")({
  head: () =>
    seoLandingHead({
      title: "AI Writing and Editing Assistant | KovaGPT",
      description:
        "Draft, rewrite, and review emails, essays, posts, scripts, and other writing with KovaGPT.",
      path: "/ai-writer",
      ogImage: "/og/writer.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="Draft and revise writing with KovaGPT"
      intro="Use KovaGPT to create a first draft, reshape existing text, or review writing for clarity. Give it context, constraints, and examples, then check the result before sending or publishing it."
      benefits={[
        "Turn bullet points or pasted notes into a finished draft",
        "Rewrite emails to sound more professional, warmer, or more direct",
        "Use writing samples as guidance for tone and structure",
        "Generate outlines, hooks, titles, and social captions",
        "Edit for grammar, clarity, and length without losing meaning",
        "Draft or translate across supported languages",
      ]}
      details={[
        "Start from a blank page, bullet points, or a rough draft. KovaGPT can suggest structure and wording, while you remain responsible for facts, tone, and the final version.",
        "For repeated work such as emails, meeting recaps, product descriptions, and weekly updates, include the audience and a fresh example in your prompt when consistency matters.",
      ]}
      prompts={[
        "Turn these bullet points into a professional email",
        "Rewrite this paragraph to be 30% shorter without losing the argument",
        "Draft a 500-word LinkedIn post about our launch, casual but confident",
        "Give me five title options for a blog post about remote work",
        "Fix grammar and tighten this essay, but keep my voice",
      ]}
      ctas={[
        { label: "Start Writing Free", to: "/" },
        { label: "See Pricing", to: "/pricing" },
      ]}
      faq={faq}
    />
  );
}
