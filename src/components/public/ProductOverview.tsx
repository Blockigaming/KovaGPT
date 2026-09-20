import { useState } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import { PublicAction, PublicHero } from "@/components/public/PublicSections";
import { FileText, MessageSquare, Plus, Search } from "lucide-react";

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
          eyebrow=""
          title={
            <>
              Now you can
              <br />
              chat, learn &amp; create
              <br />
              all in one place.
            </>
          }
          description=""
        >
          <PublicAction to="/">Open KovaGPT</PublicAction>
          <PublicAction to="/download" secondary>
            Use KovaGPT on the web
          </PublicAction>
        </PublicHero>

        <section className="public-workflow-example" aria-labelledby="workflow-example-title">
          <aside className="public-example-sidebar" aria-hidden="true">
            <span className="public-example-sidebar-brand">✧ KovaGPT</span>
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
                <p className="public-eyebrow">
                  <span className="public-example-mark" aria-hidden="true">
                    ✧
                  </span>
                  KovaGPT · Example response
                </p>
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
              <span>＋</span>
              <span>Ask a follow-up…</span>
              <span>↑</span>
            </div>
            <p className="public-example-caption">
              Illustrative conversation. Open KovaGPT to start your own.
            </p>
          </div>
        </section>

        <section className="public-use-cases" aria-labelledby="use-cases-title">
          <div className="public-section-heading">
            <h2 id="use-cases-title">
              For your work, your ideas,
              <br />
              and everything in between.
            </h2>
          </div>
          <div className="public-use-case-grid">
            <article className="public-use-case">
              <h3>Find the right words.</h3>
              <p>
                Shape a first draft, try a different tone, or make a complicated idea easier to
                follow.
              </p>
              <div
                className="public-document-illustration"
                aria-label="Illustrative writing outline"
              >
                <span className="public-illustration-label">Example · First draft</span>
                <strong>
                  A small idea.
                  <br />A clear beginning.
                </strong>
                <span className="public-illustration-rule" />
                <span className="public-illustration-rule" />
                <span className="public-illustration-rule is-short" />
                <span className="public-illustration-note">Make it sound like you.</span>
              </div>
            </article>
            <article className="public-use-case">
              <h3>Follow your curiosity.</h3>
              <p>
                Ask a follow-up, work through an example, and find a way of understanding that
                clicks.
              </p>
              <div
                className="public-learning-illustration"
                aria-label="Illustrative learning conversation"
              >
                <span className="public-illustration-label">Example · Learn together</span>
                <span className="public-learning-question">Can you explain it another way?</span>
                <span className="public-learning-answer">Let’s start with something familiar.</span>
                <span className="public-learning-question">Now give me a question to try.</span>
              </div>
            </article>
            <article className="public-use-case">
              <h3>See the next step.</h3>
              <p>
                Break a big task into smaller pieces and turn an open-ended idea into a useful plan.
              </p>
              <div className="public-plan-illustration" aria-label="Illustrative project plan">
                <span className="public-illustration-label">Example · Project outline</span>
                <ol>
                  <li>
                    <span>01</span>Define the outcome
                  </li>
                  <li>
                    <span>02</span>Gather your ideas
                  </li>
                  <li>
                    <span>03</span>Choose where to start
                  </li>
                </ol>
              </div>
            </article>
          </div>
        </section>

        <section className="public-plan-band" aria-labelledby="overview-plans-title">
          <div>
            <h2 id="overview-plans-title">A plan for the way you work.</h2>
            <p>Compare Free, Plus, and Pro, with the modes and allowances included in each.</p>
          </div>
          <PublicAction to="/pricing">Explore plans</PublicAction>
        </section>

        <section className="public-control-section" aria-labelledby="overview-control-title">
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
        <section className="public-closing" aria-labelledby="overview-closing-title">
          <h2 id="overview-closing-title">Start with KovaGPT.</h2>
          <PublicAction to="/">Open KovaGPT</PublicAction>
        </section>
      </main>
    </PublicShell>
  );
}
