import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "KovaGPT Changelog" },
      {
        name: "description",
        content: "Follow product updates, fixes, and new features for KovaGPT.",
      },
      { property: "og:title", content: "KovaGPT Changelog" },
      { property: "og:url", content: "https://kovagpt.com/changelog" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/changelog" }],
  }),
  component: () => (
    <PublicShell>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight mb-3">KovaGPT Changelog</h1>
        <p className="text-muted-foreground mb-8">
          Follow product updates, fixes, and new features for KovaGPT.
        </p>
        <p className="text-sm text-muted-foreground">
          No major public updates have been posted yet.
        </p>
      </main>
    </PublicShell>
  ),
});
