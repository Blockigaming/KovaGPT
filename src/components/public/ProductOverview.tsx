import { useState } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import { PublicAction, PublicHero, PublicSection } from "@/components/public/PublicSections";
import { PublicFaq } from "@/components/public/PublicFaq";

const examples = [
  {
    label: "Write",
    prompt: "Help me turn these rough notes into a clear first draft.",
    title: "Find the thread in your ideas.",
    body: "Start with the main point, give it a little context, and close with a useful next step. Then refine the tone until it sounds like you.",
    steps: ["A clear opening", "The details that matter", "A next step your reader can take"],
  },
  {
    label: "Learn",
    prompt: "Explain a difficult idea, then help me check my understanding.",
    title: "Make room for the next question.",
    body: "Break a topic into smaller parts. Try an example, explain it in your own words, and revisit the part that still feels unclear.",
    steps: ["Understand the idea", "Work through an example", "Try it for yourself"],
  },
  {
    label: "Plan",
    prompt: "Help me turn a big project into a manageable plan.",
    title: "Give the work a place to start.",
    body: "Define the outcome, gather what you need, and choose the first useful task. Keep the plan flexible as you learn more.",
    steps: ["Define the outcome", "Set a few milestones", "Choose the first task"],
  },
] as const;

export function ProductOverview() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="public-overview">
        <PublicHero
          eyebrow="Meet KovaGPT"
          title={
            <>
              Your ideas.
              <br />A little further.
            </>
          }
          description="A place to ask questions, shape a first draft, and think through what comes next."
        >
          <PublicAction to="/">Open KovaGPT</PublicAction>
          <PublicAction to="/pricing" secondary>
            Explore plans
          </PublicAction>
        </PublicHero>

        <section className="public-workflow-example" aria-labelledby="workflow-example-title">
          <div className="public-example-toolbar">
            <h2 id="workflow-example-title">One conversation. Many possibilities.</h2>
            <div className="public-example-options" role="group" aria-label="Choose an example">
              {examples.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={selected === index}
                  aria-controls="workflow-example-content"
                  onClick={() => setSelected(index)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div
            id="workflow-example-content"
            className="public-example-conversation"
            aria-live="polite"
          >
            <p className="public-example-prompt">{example.prompt}</p>
            <div className="public-example-answer">
              <p className="public-eyebrow">KovaGPT · Example response</p>
              <h3>{example.title}</h3>
              <p>{example.body}</p>
              <ol>
                {example.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
          <p className="public-example-caption">
            Illustrative conversation. Open KovaGPT to start your own.
          </p>
        </section>

        <PublicSection
          id="conversation"
          eyebrow="Start with chat"
          title="You don't need a perfect prompt."
        >
          <p>
            Bring the question, the rough notes, or the part you’re stuck on. Ask for an
            explanation, compare a few approaches, or work on a draft together.
          </p>
          <p>Keep asking, editing, and checking the result until it’s useful to you.</p>
          <PublicAction to="/" secondary>
            Start a conversation
          </PublicAction>
        </PublicSection>
        <PublicSection
          id="context"
          eyebrow="Keep your context"
          title="A place for the work that keeps growing."
        >
          <p>
            Use Projects to organize related work and Library to return to saved material. Bring the
            relevant context into your next conversation.
          </p>
          <div className="public-actions">
            <PublicAction to="/projects" secondary>
              Explore Projects
            </PublicAction>
            <PublicAction to="/library" secondary>
              Open Library
            </PublicAction>
          </div>
        </PublicSection>
        <PublicSection id="control" eyebrow="Make it yours" title="Your pace. Your preferences.">
          <p>
            Compare the available plans, choose the tools that fit your task, and review your
            account and data settings as you go.
          </p>
          <PublicAction to="/consumer-privacy" secondary>
            Explore privacy controls
          </PublicAction>
        </PublicSection>
        <div className="public-overview-faq">
          <PublicFaq
            items={[
              {
                q: "Where should I start?",
                a: "Open KovaGPT and describe what you want to work on. You can start with a question or a rough idea and refine it as you go.",
              },
              {
                q: "Which plan should I choose?",
                a: "The pricing page shows KovaGPT’s published plans, modes, and allowances. Compare those with the work you expect to do.",
              },
              {
                q: "Can I trust every answer?",
                a: "AI can make mistakes. Review important details, check sources, and use your own judgment before relying on a result.",
              },
            ]}
          />
        </div>
        <section className="public-closing" aria-labelledby="overview-closing-title">
          <h2 id="overview-closing-title">What would you like to work on?</h2>
          <PublicAction to="/">Open KovaGPT</PublicAction>
        </section>
      </main>
    </PublicShell>
  );
}
