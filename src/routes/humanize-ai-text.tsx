import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "What does 'humanize AI text' mean?",
    a: "Here it means editing a draft for clarity, specificity, varied pacing, and a voice appropriate to the reader. It does not prove that a human wrote the text.",
  },
  {
    q: "Can a rewrite guarantee an AI-detector result?",
    a: "No. Detectors can be wrong and can change over time. KovaGPT does not promise that rewritten text will receive a particular score or pass a detector.",
  },
  {
    q: "Will the facts and citations remain correct?",
    a: "Not automatically. Rewriting can change meaning, numbers, names, quotations, or citation relationships. Compare the revision with the source and independently verify important claims.",
  },
  {
    q: "When is rewriting appropriate?",
    a: "Use it when you have permission to revise the material and follow the disclosure, authorship, academic, workplace, and client rules that apply to the final use.",
  },
  {
    q: "How can I make the result sound more like me?",
    a: "Provide a short sample you own, describe the intended reader and tone, identify phrases to avoid, and request several alternatives. Treat the result as a draft to edit, not a verified copy of your voice.",
  },
];

export const Route = createFileRoute("/humanize-ai-text")({
  head: () =>
    seoLandingHead({
      title: "How to Revise AI-Assisted Text Responsibly | KovaGPT",
      description:
        "A practical guide to revising AI-assisted drafts for clarity, tone, specificity, and accuracy without detector or authorship guarantees.",
      path: "/humanize-ai-text",
      ogImage: "/og/home.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="How to Revise AI-Assisted Text Responsibly"
      intro="A useful rewrite should make a draft clearer and more specific while keeping the writer accountable for every claim. KovaGPT can suggest revisions, but it cannot prove human authorship, guarantee a detector result, or promise that meaning and facts stayed unchanged."
      benefits={[
        "State the reader, purpose, and tone before rewriting",
        "Cut filler and replace vague wording with supported specifics",
        "Request alternatives for sentences that do not sound like you",
        "Protect quotations, numbers, names, and citations during review",
        "Read the revision aloud and edit it in your own judgment",
        "Follow applicable authorship and AI-disclosure rules",
      ]}
      details={[
        "Start by marking the non-negotiable content: facts, quoted language, numbers, legal terms, citations, and the actual conclusion. Ask for a revision around those items, then compare the output line by line. A smoother sentence is not useful if it changes the claim.",
        "Give concrete style direction. Name the reader, desired level of formality, acceptable length, and words to avoid. A short writing sample you own can help communicate preferences, but the model's result is only an approximation of your voice.",
        "Remove generic transitions and unsupported intensifiers. Replace phrases such as 'many studies show' with an actual source or delete the claim. Do not ask the model to invent a personal anecdote, credential, source, or lived experience.",
        "Use sentence-length variation when it improves readability, not to game a detector. AI detectors can misclassify both human and AI-assisted writing, and no rewrite can guarantee a score.",
        "Finish with a factual pass and a policy pass. Open citations, recalculate important numbers, and confirm that the final use complies with school, workplace, publisher, client, and legal requirements.",
      ]}
      prompts={[
        "Revise this for a clear, conversational tone. Keep every number, name, quotation, and citation unchanged. Flag anything you cannot preserve confidently: [paste text]",
        "Give me three alternatives for this paragraph: direct, warm, and formal. Do not add new facts: [paste text]",
        "Cut filler and reduce this by 25%. List any factual statement you changed: [paste text]",
        "Compare my draft with the revision and identify changes in meaning or emphasis: [paste both]",
        "Use this writing sample only as a tone reference. Do not copy phrases or invent personal experiences: [sample and draft]",
      ]}
      ctas={[
        { label: "Revise with KovaGPT", to: "/ai-humanizer" },
        { label: "Open KovaGPT", to: "/" },
      ]}
      faq={faq}
    />
  );
}
