import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

const faq = [
  {
    q: "Will it sound like me or like AI?",
    a: "KovaGPT learns your voice from the writing you share and the tone you request. Give it one or two examples of past writing and it will match your rhythm, vocabulary, and pacing instead of producing generic AI prose.",
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
    a: "Yes. KovaGPT writes and edits in dozens of languages, and can translate between them while preserving tone and meaning.",
  },
];

export const Route = createFileRoute("/ai-writer")({
  head: () =>
    seoLandingHead({
      title: "AI Writer for Emails, Essays, Posts & Scripts | KovaGPT",
      description:
        "Draft, rewrite, and polish anything with KovaGPT's AI writer. Keeps your voice, cuts filler, and works across emails, essays, blog posts, scripts, and captions.",
      path: "/ai-writer",
      ogImage: "/og/writer.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Writer That Sounds Like You, Not Like a Bot"
      intro="KovaGPT helps you draft, rewrite, and polish writing across every format that matters - emails, essays, blog posts, scripts, LinkedIn posts, captions, product copy - while keeping your voice, not replacing it. Give it a topic or a rough draft and it delivers clear, publishable prose in seconds."
      benefits={[
        "Turn bullet points or pasted notes into a finished draft",
        "Rewrite emails to sound more professional, warmer, or more direct",
        "Match your existing tone from writing samples",
        "Generate outlines, hooks, titles, and social captions",
        "Edit for grammar, clarity, and length without losing meaning",
        "Translate while preserving voice",
      ]}
      details={[
        "Writing is rarely the bottleneck - it's the blank page, the tenth revision, or the email you've been putting off for three days. KovaGPT compresses that friction. Describe what you need and it produces a real draft you can send, publish, or hand to an editor.",
        "It's especially good at the boring high-volume writing: routine emails, meeting recaps, product descriptions, weekly updates, LinkedIn posts. Set the tone once and KovaGPT keeps delivering in that voice.",
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
