import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { DiscoveryWorkspace } from "@/components/DiscoveryWorkspace";
export const Route = createFileRoute("/maps")({
  component: LocalDiscoveryPage,
  head: () => ({
    meta: [
      { title: "Local places | KovaGPT" },
      {
        name: "description",
        content:
          "Find sourced local web results using a place you enter, with external map handoffs.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});
function LocalDiscoveryPage() {
  return (
    <AppShell>
      <main id="main-content" tabIndex={-1} className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8">
          <h1 className="text-3xl font-semibold">Local places</h1>
          <p className="text-sm text-muted-foreground">
            Find web sources and open external maps. No location permission has been requested.
          </p>
          <DiscoveryWorkspace initialMode="local" />
        </div>
      </main>
    </AppShell>
  );
}
