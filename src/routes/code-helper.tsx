import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/SeoLanding";
import { seoLandingHead } from "@/components/seo-landing-head";

const faq = [
  {
    q: "What languages and frameworks does it know?",
    a: "KovaGPT can attempt help across common programming languages and frameworks. Coverage and accuracy depend on the underlying model and supplied context, so run the code and consult current official documentation.",
  },
  {
    q: "Can it debug a real error from my project?",
    a: "Paste the error message, relevant code, runtime version, and stack trace when available. KovaGPT can propose a cause and possible fix, but you still need to reproduce the issue, test the change, and check current official documentation.",
  },
  {
    q: "Does it write tests?",
    a: "You can ask for unit, integration, or end-to-end test drafts. Generated tests can contain invalid APIs, weak assertions, or unsafe assumptions, so run and review them in your own isolated development environment.",
  },
  {
    q: "Will it explain code I don't understand?",
    a: "Paste the relevant function or file and ask for a plain-English walkthrough. KovaGPT can attempt to explain regex, complex SQL, TypeScript generics, and unfamiliar code, but you should verify the explanation against the code and current documentation.",
  },
];

export const Route = createFileRoute("/code-helper")({
  head: () =>
    seoLandingHead({
      title: "AI Code Helper - Debug, Explain, Refactor | KovaGPT",
      description:
        "Use KovaGPT to inspect errors, explain supplied code, draft tests, and suggest refactors, then validate every change in your own development environment.",
      path: "/code-helper",
      ogImage: "/og/code.jpg",
      faq,
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      h1="AI Code Helper for Debugging and Drafting"
      intro="KovaGPT can inspect stack traces and supplied code, suggest tests or refactors, and draft components. It does not run or verify the result for you, and model knowledge can be outdated, so use version-specific documentation and execute changes in an isolated development environment."
      benefits={[
        "Analyze error messages and relevant stack-trace context",
        "Explain unfamiliar functions, regex, SQL, or TypeScript generics in plain English",
        "Draft unit, integration, and end-to-end tests for review",
        "Refactor for readability, performance, or a different pattern",
        "Scaffold components, API routes, migrations, and boilerplate",
        "Draft code examples that you can test against current documentation",
      ]}
      details={[
        "Paste the smallest relevant error, code section, runtime version, and expected behavior. KovaGPT can propose a diagnosis, but the answer is not guaranteed to compile or address the real root cause without the full environment.",
        "Use generated tests, documentation, migrations, and refactors as reviewable drafts. Check security boundaries, data-loss risk, dependency versions, licenses, and rollback behavior before applying a change.",
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
