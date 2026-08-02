import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

const faq = [
  {
    q: "Will KovaGPT do my homework for me?",
    a: "KovaGPT is intended as a study aid, not a shortcut. It can attempt explanations, draft worked examples, and generate quizzes, but you should verify the material and follow your school's rules on AI use.",
  },
  {
    q: "Can it help with math and STEM?",
    a: "KovaGPT can attempt explanations and worked examples across common STEM subjects. It can make calculation or reasoning mistakes, so check each step against course material or a qualified instructor.",
  },
  {
    q: "Can I upload my textbook or lecture notes?",
    a: "You can paste text or upload supported files and images when uploads are available. KovaGPT can use content only when extraction succeeds; verify that a summary or answer matches the original material.",
  },
  {
    q: "Does it work for language learning?",
    a: "You can request conversation practice, vocabulary drills, grammar explanations, and translation in languages the underlying model supports. Quality varies, so use fluent or authoritative review where accuracy matters.",
  },
];

export const Route = createFileRoute("/study-assistant")({
  head: () =>
    seoLandingHead({
      title: "AI Study Assistant - Explanations, Quizzes & Notes | KovaGPT",
      description:
        "Ask KovaGPT for explanations, practice questions, note summaries, flashcards, and worked examples, then verify the material against trusted course sources.",
      path: "/study-assistant",
      ogImage: "/og/writer.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Study Assistant for Explanations and Practice"
      intro="KovaGPT can explain topics, draft quizzes, and turn supplied notes into study materials. It can also be wrong or misunderstand an uploaded source, so check important steps and facts against your course material and follow your school's AI rules."
      benefits={[
        "Request step-by-step explanations at a chosen level",
        "Practice questions and quizzes on supported topics",
        "Turn lecture notes and textbooks into summaries and flashcards",
        "Worked-example drafts for math, science, and coding topics",
        "Language practice: conversation, grammar, vocabulary drills",
        "Build a focused study plan and work through it step by step",
      ]}
      details={[
        "Ask KovaGPT to explain a concept and then test your understanding. You can request hints before answers, practice at a particular level, or a second explanation using a different analogy. These are generated suggestions, not a substitute for an instructor.",
        "Upload supported notes or paste a section when file extraction is available. Ask KovaGPT to summarize, quiz you, or point to confusing parts, then compare the result with the original instead of assuming it read every detail correctly.",
      ]}
      prompts={[
        "Explain photosynthesis at a 10th-grade level, then quiz me",
        "Walk me through this calculus problem step by step",
        "Turn these lecture notes into 20 flashcards",
        "Give me a 30-minute study plan for the SAT reading section",
        "Practice Spanish conversation with me at an A2 level",
      ]}
      ctas={[
        { label: "Start Studying", to: "/" },
        { label: "Explore Modes", to: "/modes" },
      ]}
      faq={faq}
    />
  );
}
