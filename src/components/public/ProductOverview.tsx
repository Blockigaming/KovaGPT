import "./product-showcase.css";
import { NovaLogo } from "@/components/NovaLogo";
import { useState } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import { PublicAction, PublicHero } from "@/components/public/PublicSections";
import { Button } from "@/components/ui/button";
import { ArrowUp, FileText, MessageSquare, Plus, Search } from "lucide-react";

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
      <main
        id="main-content"
        tabIndex={-1}
        className="public-overview kova-product-overview"
        data-ui-reference="chatgpt-product-overview"
      >
        <div className="kova-showcase-progress" aria-hidden="true" />
        <div className="kova-showcase-hero">
          <PublicHero
            eyebrow=""
            title="Chat, write, and plan in one place."
            description="Write a first draft, understand a new idea, or turn a project into a plan."
          >
            <PublicAction to="/">Open KovaGPT</PublicAction>
            <PublicAction to="/download" secondary>
              Download the app
            </PublicAction>
          </PublicHero>
        </div>

        <div className="kova-overview-story">
          <section
            id="workflow-example"
            className="public-workflow-example kova-showcase-jump"
            data-ui-reference="chatgpt-conversation-example"
            aria-labelledby="workflow-example-title"
          >
            <aside className="public-example-sidebar" aria-hidden="true">
              <span className="public-example-sidebar-brand">
                <NovaLogo decorative className="h-6 w-6" /> KovaGPT
              </span>
              <span>
                <Plus size={15} /> New chat
              </span>
              <span>
                <Search size={15} /> Search chats
              </span>
              <span>
                <FileText size={15} /> Library
              </span>
              <small>Conversations</small>
              <span className="is-current">
                <MessageSquare size={15} /> A fresh perspective
              </span>
              <span>Making a plan</span>
              <span>Working through an idea</span>
            </aside>
            <div className="public-example-main">
              <div className="public-example-toolbar">
                <h2 id="workflow-example-title" tabIndex={-1}>
                  Example conversation
                </h2>
                <div className="public-example-options" role="group" aria-label="Choose an example">
                  {examples.map((item, index) => (
                    <Button
                      key={item.label}
                      type="button"
                      variant={selected === index ? "secondary" : "ghost"}
                      size="sm"
                      aria-pressed={selected === index}
                      aria-controls="workflow-example-content"
                      onClick={() => setSelected(index)}
                    >
                      {item.label}
                    </Button>
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
              <div className="public-example-composer" aria-hidden="true">
                <span>
                  <Plus size={20} />
                </span>
                <span>Ask a follow-up…</span>
                <span>
                  <ArrowUp size={20} />
                </span>
              </div>
              <p className="public-example-caption">
                Illustrative conversation. Open KovaGPT to start your own.
              </p>
            </div>
          </section>

          <section className="kova-overview-chapters" aria-label="Ways to use KovaGPT">
            {examples.map((item, index) => (
              <article className="kova-overview-chapter" key={item.label} data-example={index}>
                <h2>{item.label}</h2>
                <p>{item.title}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(index);
                    document
                      .getElementById("workflow-example-title")
                      ?.focus({ preventScroll: true });
                    document
                      .getElementById("workflow-example")
                      ?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  View example <span aria-hidden="true">↗</span>
                </button>
              </article>
            ))}
          </section>
        </div>

        <section
          className="public-plan-band kova-showcase-enter"
          aria-labelledby="overview-plans-title"
        >
          <div>
            <h2 id="overview-plans-title">A plan for the way you work.</h2>
            <p>Compare Free, Plus, and Pro, with the modes and allowances included in each.</p>
          </div>
          <PublicAction to="/pricing">Explore plans</PublicAction>
        </section>

        <section
          className="public-control-section kova-showcase-enter"
          aria-labelledby="overview-control-title"
        >
          <div className="public-section-heading">
            <h2 id="overview-control-title">Your work. Your choices.</h2>
            <p>Understand your settings and take a thoughtful approach to every answer.</p>
          </div>
          <div className="public-control-grid">
            <article>
              <h3>Know your privacy options.</h3>
              <p>
                Review how KovaGPT handles information and where to find your account and data
                controls.
              </p>
              <PublicAction to="/consumer-privacy" secondary>
                Explore privacy controls
              </PublicAction>
            </article>
            <article>
              <h3>Keep your judgment in the loop.</h3>
              <p>
                AI can make mistakes. Check sources, review important details, and decide what works
                for you.
              </p>
              <PublicAction to="/" secondary>
                Start a conversation
              </PublicAction>
            </article>
          </div>
        </section>
        <section
          className="public-closing kova-showcase-enter"
          aria-labelledby="overview-closing-title"
        >
          <h2 id="overview-closing-title">Start with KovaGPT.</h2>
          <PublicAction to="/">Open KovaGPT</PublicAction>
        </section>
      </main>
    </PublicShell>
  );
}
