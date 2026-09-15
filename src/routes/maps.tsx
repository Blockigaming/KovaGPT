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
        content: "Explore real places, terrain, streets, and satellite imagery with Kova Maps.",
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
