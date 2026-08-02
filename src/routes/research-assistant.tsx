import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "Can it read PDFs and documents?",
    a: "KovaGPT can use supported files when upload access is available and text extraction succeeds. File type, size, formatting, permissions, and provider support can limit what is actually read.",
  },
  {
    q: "Does it cite sources?",
    a: "Search and Deep Research can return source links when their providers are available. A citation can be missing, wrong, or unrelated to the claim. Open the source and verify important facts against primary material.",
  },
  {
    q: "Can it compare multiple options for me?",
    a: "You can request a side-by-side comparison using criteria you supply. Check every time-sensitive price or feature against the option's current official source.",
  },
  {
    q: "Is it good for academic research?",
    a: "It can be used for a first-pass organization of supplied sources, argument outlines, and reading summaries. Always verify claims and citations against primary sources before submitting academic work.",
  },
];

export const Route = createFileRoute("/research-assistant")({
  head: () =>
    seoLandingHead({
      title: "AI Research Assistant for Reports, Notes & Comparisons | KovaGPT",
      description:
        "Use KovaGPT to organize supplied material, draft summaries, compare options, and structure notes, with source and provider verification.",
      path: "/research-assistant",
      ogImage: "/og/writer.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Research Assistant for Organizing Sources and Drafting Insights"
      intro="KovaGPT can organize extracted file content and supplied notes, draft summaries or comparisons, and help structure a report. It may miss content, misunderstand a source, or generate an incorrect citation, so keep the originals open and verify the result."
      benefits={[
        "Draft summaries of supported files when extraction succeeds",
        "Compare two or more options across criteria you define",
        "Attempt structured extraction of dates, prices, entities, and decisions",
        "Draft structured outlines, briefs, or slide plans from supplied notes",
        "Ask questions against successfully extracted source content",
        "Continue locally stored research threads later in the same browser while that history remains available",
      ]}
      details={[
        "Use KovaGPT to reduce the manual work of organizing notes and drafting an initial synthesis. Extraction and model output can omit tables, footnotes, scanned text, or qualifiers, so compare the answer with the original source.",
        "For competitive research, literature reviews, market snapshots, product research, due diligence, or study guides, label sourced facts, inferences, and estimates separately. Treat the generated brief as a first draft for human review.",
      ]}
      prompts={[
        "Summarize this PDF and pull out every decision the authors recommend",
        "Compare these three CRMs across pricing, features, and support",
        "Turn this transcript into a two-page executive brief",
        "Extract every dollar figure and date from this contract",
        "Build a study outline from these lecture notes",
      ]}
      ctas={[
        { label: "Start Researching", to: "/" },
        { label: "Explore Modes", to: "/modes" },
      ]}
      faq={faq}
    />
  );
}
