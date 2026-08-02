import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "Does it actually beat AI detectors?",
    a: "KovaGPT rewrites for natural rhythm, varied sentence length, and specific detail - the exact signals detectors use to flag machine-written text. Results vary by detector and content, so always review the output before submitting.",
  },
  {
    q: "Will my meaning stay the same?",
    a: "Yes. Humanizing changes the delivery, not the argument. If you want factual accuracy preserved, paste the source content and KovaGPT will keep every claim intact while rewriting the prose.",
  },
  {
    q: "Can it match my personal writing style?",
    a: "Yes. Paste one or two samples of your past writing and ask KovaGPT to match your voice. It will pick up your rhythm, vocabulary, and quirks.",
  },
  {
    q: "Is this ethical to use for school work?",
    a: "KovaGPT is a rewriting tool. Whether using it fits your assignment or workplace rules is your call - check your school's or employer's AI policy first.",
  },
];

export const Route = createFileRoute("/ai-humanizer")({
  head: () =>
    seoLandingHead({
      title: "AI Humanizer - Rewrite AI Text to Sound Human | KovaGPT",
      description:
        "Humanize AI-generated text with KovaGPT. Rewrite stiff, robotic AI output into natural, human-sounding writing that reads clearly and passes AI detection.",
      path: "/ai-humanizer",
      ogImage: "/og/writer.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Humanizer: Make AI Text Sound Human"
      intro="KovaGPT rewrites AI-generated drafts so they sound natural, conversational, and clearly written by a person. Paste any AI output and ask KovaGPT to humanize it - vary sentence length, drop generic phrasing, add specifics, and match your own voice. Useful for emails, essays, blog posts, social captions, and anything that currently reads stiff or robotic."
      benefits={[
        "Rewrite AI text in a natural, human tone",
        "Vary sentence length and rhythm so it reads like you wrote it",
        "Remove generic AI phrasing and filler words",
        "Match a specific voice: casual, professional, academic, friendly",
        "Refine output to pass common AI detection patterns",
        "Preserve the original meaning and factual claims",
      ]}
      details={[
        "AI text has tells: uniformly-long sentences, hedging phrases, over-signposting, and vocabulary that no human would reach for. KovaGPT rewrites past those tells - mixing short and long sentences, cutting throat-clearing, using specific words instead of vague ones.",
        "For best results, tell KovaGPT the context: who's reading it, what tone you want, and whether it should sound polished, casual, or somewhere in between. The more context, the more human the output.",
      ]}
      prompts={[
        "Humanize this paragraph and make it sound like I wrote it",
        "Rewrite this in a casual, conversational tone",
        "Make this AI text less robotic and more natural",
        "Edit this so it reads like a real person, not a chatbot",
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
