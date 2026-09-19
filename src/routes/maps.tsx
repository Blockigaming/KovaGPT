import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { KovaMaps } from "@/components/KovaMaps";
export const Route = createFileRoute("/maps")({
  component: MapsPage,
  head: () => ({
    meta: [
      { title: "Maps | KovaGPT" },
      {
        name: "description",
        content:
          "Kova Maps is unavailable while provider, legal, privacy, capacity, and cost approval is pending.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});
function MapsPage() {
  return (
    <AppShell>
      <KovaMaps />
    </AppShell>
  );
}
