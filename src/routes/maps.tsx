import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, LocateFixed, MapPinned, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/maps")({
  component: MapsDecisionGate,
  head: () => ({
    meta: [
      { title: "Maps preview | KovaGPT" },
      {
        name: "description",
        content: "Review the privacy choices planned for map-assisted discovery in KovaGPT.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const suggestions = [
  "Find a quiet place to work near a location I enter",
  "Compare places from links I provide",
  "Plan stops without sharing my device location",
];

function MapsDecisionGate() {
  return (
    <AppShell>
      <main id="main-content" className="min-h-full overflow-y-auto bg-background" tabIndex={-1}>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
          <header className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <MapPinned className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Product preview</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Maps, with location on your terms
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                Map-assisted discovery is not available yet. KovaGPT will not request your device
                location or display map data until a licensed provider and the privacy controls
                below are approved.
              </p>
            </div>
          </header>

          <section className="grid gap-4 sm:grid-cols-2" aria-labelledby="privacy-title">
            <h2 id="privacy-title" className="sr-only">
              Planned location choices
            </h2>
            <article className="rounded-2xl border border-border bg-card p-5">
              <LocateFixed className="mb-4 h-5 w-5" aria-hidden="true" />
              <h3 className="font-semibold">Choose what to share</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Planned controls include manual place entry, coarse or precise device location,
                denial recovery, and a clear remove-location action.
              </p>
            </article>
            <article className="rounded-2xl border border-border bg-card p-5">
              <ShieldCheck className="mb-4 h-5 w-5" aria-hidden="true" />
              <h3 className="font-semibold">No silent access</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                KovaGPT will explain why location is requested before the browser prompt. Declining
                will keep manual location entry available.
              </p>
            </article>
          </section>

          <section className="space-y-3" aria-labelledby="suggestions-title">
            <h2 id="suggestions-title" className="text-lg font-semibold">
              Try without Maps
            </h2>
            <div className="grid gap-2">
              {suggestions.map((suggestion) => (
                <Link
                  key={suggestion}
                  to="/"
                  search={{ prompt: suggestion } as never}
                  className="min-h-11 rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {suggestion}
                </Link>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to chat
              </Link>
            </Button>
            <span className="text-sm text-muted-foreground" role="status">
              No location permission has been requested.
            </span>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
