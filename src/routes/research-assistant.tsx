import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

const faq = [
  {
    q: "Can it read PDFs and documents?",
    a: "Yes. Upload PDFs, Word docs, spreadsheets, slides, and text files. KovaGPT extracts the content and answers questions against it, summarizes, or pulls out specific data.",
  },
  {
    q: "Does it cite sources?",
    a: "When you give KovaGPT source material — a PDF, article, or document — it points to the sections it drew from. For open-ended research, always verify facts against primary sources.",
  },
  {
    q: "Can it compare multiple options for me?",
    a: "Yes. Give it two or more options and KovaGPT builds a side-by-side comparison across the criteria you care about — price, features, pros, cons, use cases.",
  },
  {
    q: "Is it good for academic research?",
    a: "It's a strong first-pass tool for organizing sources, outlining arguments, and summarizing readings. Always verify claims and citations against primary sources before submitting academic work.",
  },
];

export const Route = createFileRoute("/research-assistant")({
  head: () =>
    seoLandingHead({
      title: "AI Research Assistant for Reports, Notes & Comparisons | KovaGPT",
      description:
        "KovaGPT organizes sources, summarizes long documents, compares options, and turns messy notes into structured research. Upload PDFs and ask questions directly.",
      path: "/research-assistant",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Research Assistant That Turns Sources Into Insight"
      intro="KovaGPT reads what you give it, organizes it, and answers questions in plain English. Drop in a PDF, a stack of notes, or a URL and get summaries, comparisons, outlines, and specific answers — with the structure ready to use in reports, briefs, or study guides."
      benefits={[
        "Summarize long PDFs, papers, and articles in seconds",
        "Compare two or more options across criteria you define",
        "Extract structured data — dates, prices, entities, decisions — from documents",
        "Turn messy notes into clean outlines, briefs, or slide plans",
        "Answer specific questions against uploaded sources",
        "Save research threads so you can continue tomorrow",
      ]}
      details={[
        "Research is mostly reading, note-taking, and pattern-finding. KovaGPT accelerates all three. Upload a 40-page report and ask 'what are the three main risks the authors identify' — you get the answer in seconds, with pointers back to the relevant sections.",
        "It's built for real work: competitive teardowns, literature reviews, market snapshots, product research, due diligence, and study guides. When you're ready to write, it can turn the research thread into a first draft.",
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
