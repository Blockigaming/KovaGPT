import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/ai-safety")({
  head: () => ({
    meta: [
      { title: "KovaGPT Safety" },
      {
        name: "description",
        content:
          "How to use KovaGPT safely, what it should not be used for, and our content limits.",
      },
      { property: "og:title", content: "AI Safety - KovaGPT" },
      {
        property: "og:description",
        content:
          "How to use KovaGPT safely, what it should not be used for, and our content limits.",
      },
      { property: "og:url", content: "https://kovagpt.com/ai-safety" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/ai-safety" }],
  }),
  component: AISafetyPage,
});

function AISafetyPage() {
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 prose prose-invert prose-lg leading-relaxed prose-headings:mt-10 prose-p:my-5"
      >
        <h1>AI Safety</h1>
        <p>
          KovaGPT is designed to help with writing, learning, coding, research, brainstorming, and
          image generation. Because AI can make mistakes, users should always review and verify
          important information.
        </p>
        <p>
          KovaGPT should not be used as the only source for medical, legal, financial, emergency, or
          safety decisions. For serious or time-sensitive situations, contact a qualified
          professional or trusted source.
        </p>
        <p>
          Users may not use KovaGPT to create harmful, illegal, abusive, deceptive, or dangerous
          content. This includes attempts to harm others, bypass security systems, steal private
          information, or abuse the platform.
        </p>
        <p>
          KovaGPT may limit, block, or refuse certain requests to help keep users safe and prevent
          misuse.
        </p>

        <h2>Study use</h2>
        <p>
          KovaGPT is meant to help you learn, brainstorm, and understand topics. Do not use it to
          cheat, submit work you did not understand, or break your school's rules.
        </p>

        <h2>Strong disclaimer</h2>
        <p>
          KovaGPT is an AI assistant and may produce incorrect, incomplete, or outdated information.
          Do not rely on KovaGPT as your only source for medical, legal, financial, safety, or
          emergency decisions. Always verify important information with a trusted source or
          qualified professional.
        </p>

        <p className="mt-8">
          <Link to="/">← Back to KovaGPT</Link>
        </p>
      </main>
    </PublicShell>
  );
}
