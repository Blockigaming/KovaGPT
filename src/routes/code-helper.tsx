import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "What languages and frameworks does it know?",
    a: "JavaScript, TypeScript, Python, Go, Rust, Java, C#, C++, PHP, Ruby, SQL, Swift, Kotlin, and the major frameworks (React, Next, Vue, Svelte, Node, Django, Rails, .NET, Spring, Flutter, and more).",
  },
  {
    q: "Can it debug a real error from my project?",
    a: "Yes. Paste the error message, the relevant code, and any context - KovaGPT explains what's wrong, why it's happening, and how to fix it. For gnarlier bugs, share the stack trace.",
  },
  {
    q: "Does it write tests?",
    a: "Yes. Ask for unit tests, integration tests, or e2e tests in your framework of choice - Jest, Vitest, Pytest, Playwright, Cypress - and KovaGPT delivers runnable test files.",
  },
  {
    q: "Will it explain code I don't understand?",
    a: "Paste any function or file and ask for a plain-English walkthrough. KovaGPT is especially good at explaining regex, complex SQL, TypeScript generics, and unfamiliar codebases.",
  },
];

export const Route = createFileRoute("/code-helper")({
  head: () =>
    seoLandingHead({
      title: "AI Code Helper - Debug, Explain, Refactor | KovaGPT",
      description:
        "Ship faster with KovaGPT: debug errors, explain unfamiliar code, generate tests, refactor for readability, and scaffold components across every major language and framework.",
      path: "/code-helper",
      ogImage: "/og/code.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Code Helper for Developers Who Ship"
      intro="KovaGPT debugs stack traces, explains unfamiliar code, generates tests, refactors for readability, and scaffolds components across every major language and framework. It's the pair programmer that never gets tired and never judges your variable names."
      benefits={[
        "Debug errors with stack-trace-level reasoning",
        "Explain unfamiliar functions, regex, SQL, or TypeScript generics in plain English",
        "Generate unit, integration, and e2e tests in your framework",
        "Refactor for readability, performance, or a different pattern",
        "Scaffold components, API routes, migrations, and boilerplate",
        "Answer language and framework questions with runnable code",
      ]}
      details={[
        "Every developer has three recurring problems: an error they've never seen, a codebase they didn't write, and a task they know how to do but not fast. KovaGPT is built for exactly those. Paste the error, paste the file, describe the task - get an answer that compiles.",
        "It also handles the invisible work: writing the test you skipped, documenting the function you promised to document, converting the CommonJS file to ESM, cleaning up the migration you rushed. The unsexy stuff that makes codebases livable.",
      ]}
      prompts={[
        "Why am I getting 'Cannot read property map of undefined' in this React component?",
        "Explain what this regex does and give me a safer version",
        "Refactor this function to be pure and add Vitest tests",
        "Convert this Express route to a TanStack Start server function",
        "Write a Postgres migration to add a soft-delete column with a partial index",
      ]}
      ctas={[
        { label: "Start Coding", to: "/" },
        { label: "Explore Modes", to: "/modes" },
      ]}
      faq={faq}
    />
  );
}
