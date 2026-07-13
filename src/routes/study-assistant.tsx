import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding, seoLandingHead } from "@/components/SeoLanding";

const faq = [
  {
    q: "Will KovaGPT do my homework for me?",
    a: "KovaGPT is a study tool, not a shortcut. It explains concepts, walks through worked examples, and quizzes you - the goal is to help you actually learn the material. Follow your school's rules on AI use.",
  },
  {
    q: "Can it help with math and STEM?",
    a: "Yes. KovaGPT works through algebra, calculus, physics, chemistry, and CS problems step by step, showing the reasoning at each stage so you can follow along and check your own work.",
  },
  {
    q: "Can I upload my textbook or lecture notes?",
    a: "Yes. Upload PDFs and images of notes, and KovaGPT will summarize, quiz you, or answer questions grounded in that material.",
  },
  {
    q: "Does it work for language learning?",
    a: "Yes. Practice conversation, drill vocabulary, get grammar explanations, and translate with context - in most major languages.",
  },
];

export const Route = createFileRoute("/study-assistant")({
  head: () =>
    seoLandingHead({
      title: "AI Study Assistant - Explanations, Quizzes & Notes | KovaGPT",
      description:
        "Study smarter with KovaGPT: step-by-step explanations, practice quizzes, note summaries, flashcards, and worked examples across every subject.",
      path: "/study-assistant",
      ogImage: "/og/writer.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Study Assistant That Actually Teaches"
      intro="KovaGPT explains hard topics step by step, quizzes you on what you just learned, and turns dense notes into study guides you'll actually use. It works across math, science, humanities, coding, and languages - from middle school through grad school."
      benefits={[
        "Step-by-step explanations you can actually follow",
        "Practice questions and quizzes on any topic",
        "Turn lecture notes and textbooks into summaries and flashcards",
        "Worked examples for math, physics, chemistry, and CS",
        "Language practice: conversation, grammar, vocabulary drills",
        "Build a study plan and stick to it with scheduled reminders",
      ]}
      details={[
        "The best tutors don't lecture - they check your understanding, catch misconceptions early, and adjust. KovaGPT does the same: ask it to explain something and it will follow up with a question to check if it landed. Ask for practice and it generates problems tuned to what you just studied.",
        "Upload notes or a chapter, and KovaGPT becomes an expert on that specific material. Ask it to quiz you, summarize, or explain the part you got stuck on last night.",
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
