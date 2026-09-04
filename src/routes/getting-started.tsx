import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/getting-started")({
  head: () => ({
    meta: [
      { title: "KovaGPT Onboarding" },
      {
        name: "description",
        content:
          "Learn how to start chatting, choose modes, generate images, check usage, and get support with KovaGPT.",
      },
      { property: "og:title", content: "Getting Started with KovaGPT" },
      {
        property: "og:description",
        content:
          "Learn how to start chatting, choose modes, generate images, check usage, and get support with KovaGPT.",
      },
      { property: "og:url", content: "https://kovagpt.com/getting-started" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/getting-started" }],
  }),
  component: GettingStartedPage,
});

const STEPS: { title: string; body: string }[] = [
  {
    title: "1. Start a chat",
    body: "Ask a question, request help, or choose a starter prompt from the chat screen.",
  },
  {
    title: "2. Choose a mode",
    body: "Choose Instant, Medium, or Thinking on Free; Plus also unlocks High; Pro exposes its published Pro mode menu. Search and Deep Research are separate tools with provider and plan requirements.",
  },
  {
    title: "3. Sign in to save your work",
    body: "Signing in unlocks account-backed features such as projects, Library, uploads, and image generation. Standard browser conversation history is not a guaranteed cross-device archive.",
  },
  {
    title: "4. Generate images",
    body: "Verified, signed-in accounts can use the Images page within the plan's daily quota when the configured image provider is available.",
  },
  {
    title: "5. Check your usage",
    body: "Signed-in users can view daily usage from Settings → Subscription.",
  },
  { title: "6. Get help", body: "For support, contact support@kovagpt.com." },
];

function GettingStartedPage() {
  return (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight mb-3">Getting Started with KovaGPT</h1>
        <p className="text-muted-foreground mb-10">
          KovaGPT is an AI assistant for writing, studying, coding, research, image generation, and
          everyday questions.
        </p>

        <div className="space-y-4">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-xl border border-border p-5 bg-card">
              <h2 className="font-semibold mb-1">{s.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/modes" className="underline hover:text-foreground">
            Explore modes
          </Link>
          <Link to="/images" className="underline hover:text-foreground">
            Generate images
          </Link>
          <Link to="/pricing" className="underline hover:text-foreground">
            View pricing
          </Link>
          <Link to="/contact-support" className="underline hover:text-foreground">
            Contact support
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/ai-writer" className="underline hover:text-foreground">
            AI Writer
          </Link>
          <Link to="/study-assistant" className="underline hover:text-foreground">
            Study Assistant
          </Link>
          <Link to="/code-helper" className="underline hover:text-foreground">
            Code Helper
          </Link>
          <Link to="/research-assistant" className="underline hover:text-foreground">
            Research Assistant
          </Link>
          <Link to="/ai-image-generator" className="underline hover:text-foreground">
            AI Image Generator
          </Link>
        </div>

        <p className="mt-8 text-sm">
          <Link to="/" className="underline hover:text-foreground">
            ← Back to KovaGPT
          </Link>
        </p>
      </main>
    </PublicShell>
  );
}
