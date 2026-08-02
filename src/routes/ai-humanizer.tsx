import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "Does rewriting guarantee that text will pass an AI detector?",
    a: "No. AI detectors can be inaccurate and their results vary by tool, version, and text. KovaGPT is a style editor, not a way to prove human authorship or guarantee a detector result.",
  },
  {
    q: "Will my meaning stay the same?",
    a: "Not automatically. Any rewrite can change meaning, emphasis, numbers, or citations. Compare the revision with the source and restore anything that changed incorrectly.",
  },
  {
    q: "Can it match my personal writing style?",
    a: "You can provide writing samples and ask for similar tone, vocabulary, and pacing. The result is an approximation, so review it rather than treating it as a verified match.",
  },
  {
    q: "Is this ethical to use for school work?",
    a: "KovaGPT is a rewriting tool. Whether using it fits your assignment or workplace rules is your call - check your school's or employer's AI policy first.",
  },
];

export const Route = createFileRoute("/ai-humanizer")({
  head: () =>
    seoLandingHead({
      title: "AI Humanizer - Revise Tone and Clarity | KovaGPT",
      description:
        "Revise stiff or generic drafts with KovaGPT for clearer tone, varied pacing, and a more personal voice, without promises about AI detectors.",
      path: "/ai-humanizer",
      ogImage: "/og/writer.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Humanizer: Revise Stiff or Generic Drafts"
      intro="KovaGPT can revise a draft for clearer wording, varied sentence rhythm, and a tone closer to the samples or instructions you provide. It cannot prove who wrote the text, guarantee a detector result, or preserve every fact without review."
      benefits={[
        "Rewrite a draft in a clearer, more conversational tone",
        "Vary sentence length and rhythm",
        "Remove generic AI phrasing and filler words",
        "Request a specific tone: casual, professional, academic, or friendly",
        "Ask for several alternatives instead of accepting one revision",
        "Review changes against the source for meaning and factual accuracy",
      ]}
      details={[
        "Tell KovaGPT who will read the draft, the tone you want, and which phrases or facts must remain unchanged. Supplying a short sample can help describe your preference, but the model may still introduce mistakes.",
        "Use rewriting to improve work you are allowed to edit. Follow your school, employer, publisher, or client's disclosure and authorship rules. Do not use a rewrite to misrepresent authorship or evade a required review process.",
      ]}
      prompts={[
        "Revise this paragraph using the tone notes and writing sample I own",
        "Rewrite this in a casual, conversational tone",
        "Make this draft less formulaic and more direct without adding facts",
        "Edit this to remove chatbot-like filler without inventing personal details",
        "Match the voice of the sample below when you rewrite this draft",
      ]}
      ctas={[
        { label: "Humanize Text Now", to: "/" },
        { label: "See Pricing", to: "/pricing" },
      ]}
      faq={faq}
    />
  );
}
