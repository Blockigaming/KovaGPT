import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { KovaMaps } from "@/components/KovaMaps";

const MAPS_PROVIDER_APPROVED = import.meta.env.VITE_KOVA_MAPS_PROVIDER_APPROVED === "true";
export const Route = createFileRoute("/maps")({
  component: MapsPage,
  head: () => ({
    meta: [
      { title: "Maps | KovaGPT" },
      {
        name: "description",
        content: "Check the availability of the KovaGPT Maps experience.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});
function MapsPage() {
  return (
    <AppShell>
      {MAPS_PROVIDER_APPROVED ? (
        <KovaMaps />
      ) : (
        <main id="main-content" tabIndex={-1} className="grid h-full place-items-center p-8">
          <div className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
            <h1 className="text-xl font-semibold">Maps unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Maps is not enabled for this release. KovaGPT will not request your location or
              contact map providers from this page.
            </p>
          </div>
        </main>
      )}
    </AppShell>
  );
}
