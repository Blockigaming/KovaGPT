import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/modes")({
  head: () => ({
    meta: [
      { title: "KovaGPT AI Modes" },
      { name: "description", content: "Learn what each KovaGPT mode is best for - Basic, Auto, Creative, Precise, Code, Study, Reasoning, Research, Writer Pro, and Tutor Pro." },
      { property: "og:title", content: "KovaGPT AI Modes" },
      { property: "og:description", content: "Learn what each KovaGPT mode is best for." },
      { property: "og:url", content: "https://kovagpt.com/modes" },
      { property: "og:image", content: "https://kovagpt.com/og/modes.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KovaGPT AI Modes" },
      { name: "twitter:description", content: "Learn what each KovaGPT mode is best for." },
      { name: "twitter:image", content: "https://kovagpt.com/og/modes.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/modes" }],
  }),
  component: ModesPage,
});

const MODES: { name: string; copy: string; bestFor: string }[] = [
  { name: "Basic Mode", copy: "Simple everyday AI help for quick questions, writing, summaries, and general tasks.", bestFor: "Everyday questions" },
  { name: "Auto Mode", copy: "Automatically chooses the best style of response based on what you ask.", bestFor: "Choosing the right style automatically" },
  { name: "Creative Mode", copy: "Best for brainstorming, stories, ideas, names, captions, designs, and creative writing.", bestFor: "Ideas and brainstorming" },
  { name: "Precise Mode", copy: "Best for careful, direct answers when accuracy and clarity matter.", bestFor: "Clear and careful answers" },
  { name: "Code Mode", copy: "Helps write, debug, explain, and improve code.", bestFor: "Coding and debugging" },
  { name: "Study Mode", copy: "Explains topics step by step, helps with studying, and can create practice questions.", bestFor: "Learning and practice" },
  { name: "Reasoning Mode", copy: "Built for harder problems that need deeper thinking, planning, or logic.", bestFor: "Harder thinking tasks" },
  { name: "Research Mode", copy: "Helps organize information, compare sources, and create structured research summaries.", bestFor: "Structured research help" },
  { name: "Writer Pro", copy: "Helps improve essays, emails, scripts, posts, and professional writing.", bestFor: "Polished writing" },
  { name: "Tutor Pro", copy: "Gives more detailed explanations, guided learning, and personalized study help.", bestFor: "Guided learning" },
];

function ModesPage() {
  return (
    <>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight mb-3">KovaGPT AI Modes</h1>
        <p className="text-muted-foreground mb-10">
          KovaGPT modes help you get better results by matching the assistant to the task.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          {MODES.map((m) => (
            <div key={m.name} className="rounded-xl border border-border p-4 bg-card">
              <h2 className="font-semibold mb-1">{m.name}</h2>
              <p className="text-sm text-muted-foreground">{m.copy}</p>
              <p className="text-xs text-muted-foreground mt-2"><span className="font-medium text-foreground">Best for:</span> {m.bestFor}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-sm">
          <Link to="/pricing" className="underline hover:text-foreground">See which modes are included in each plan →</Link>
        </p>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/study-assistant" className="underline hover:text-foreground">Study Assistant</Link>
          <Link to="/code-helper" className="underline hover:text-foreground">Code Helper</Link>
          <Link to="/ai-writer" className="underline hover:text-foreground">AI Writer</Link>
          <Link to="/research-assistant" className="underline hover:text-foreground">Research Assistant</Link>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
