import { createFileRoute } from "@tanstack/react-router";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "KovaGPT Status" },
      { name: "description", content: "Check this page for known service issues or outages affecting KovaGPT." },
      { property: "og:title", content: "KovaGPT Status" },
      { property: "og:url", content: "https://kovagpt.com/status" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/status" }],
  }),
  component: () => (
    <>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight mb-3">KovaGPT Status</h1>
        <p className="text-muted-foreground mb-8">
          Check this page for known service issues or outages.
        </p>
        <p className="text-sm text-muted-foreground">No known issues at this time.</p>
      </main>
      <PublicFooter />
    </>
  ),
});
