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
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/modes" }],
  }),
  component: ModesPage,
});

const MODES: { name: string; copy: string }[] = [
  { name: "Basic Mode", copy: "Simple everyday AI help for quick questions, writing, summaries, and general tasks." },
  { name: "Auto Mode", copy: "Automatically chooses the best style of response based on what you ask." },
  { name: "Creative Mode", copy: "Best for brainstorming, stories, ideas, names, captions, designs, and creative writing." },
  { name: "Precise Mode", copy: "Best for careful, direct answers when accuracy and clarity matter." },
  { name: "Code Mode", copy: "Helps write, debug, explain, and improve code." },
  { name: "Study Mode", copy: "Explains topics step by step, helps with studying, and can create practice questions." },
  { name: "Reasoning Mode", copy: "Built for harder problems that need deeper thinking, planning, or logic." },
  { name: "Research Mode", copy: "Helps organize information, compare sources, and create structured research summaries." },
  { name: "Writer Pro", copy: "Helps improve essays, emails, scripts, posts, and professional writing." },
  { name: "Tutor Pro", copy: "Gives more detailed explanations, guided learning, and personalized study help." },
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
            </div>
          ))}
        </div>
        <p className="mt-10 text-sm">
          <Link to="/pricing" className="underline hover:text-foreground">See which modes are included in each plan →</Link>
        </p>
      </main>
      <PublicFooter />
    </>
  );
}
