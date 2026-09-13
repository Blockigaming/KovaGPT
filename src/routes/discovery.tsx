import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { DISCOVERY_MODES, type DiscoveryMode } from "@/lib/discovery/discovery-policy.mjs";
import { DiscoveryWorkspace } from "@/components/DiscoveryWorkspace";
export const Route = createFileRoute("/discovery")({
  component: DiscoveryPage,
  validateSearch: (search: Record<string, unknown>): { mode?: DiscoveryMode } => ({
    mode: DISCOVERY_MODES.includes(search.mode as DiscoveryMode)
      ? (search.mode as DiscoveryMode)
      : undefined,
  }),
  head: () => ({
    meta: [{ title: "Search and discovery | KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
});
function DiscoveryPage() {
  const { mode } = Route.useSearch();
  return (
    <AppShell>
      <main id="main-content" tabIndex={-1} className="min-h-full overflow-y-auto bg-background">
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8">
          <h1 className="text-3xl font-semibold">Search and discovery</h1>
          <DiscoveryWorkspace initialMode={mode ?? "web"} />
        </div>
      </main>
    </AppShell>
  );
}
