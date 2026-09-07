import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Plug } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "External Connections | KovaGPT" },
      {
        name: "description",
        content: "Current availability of KovaGPT connections for external AI assistants.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ConnectPage,
});

function ConnectPage() {
  return (
    <PublicShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16"
      >
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <Plug className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">
          Assistant connections are not available yet
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
          KovaGPT does not currently offer a standards-complete remote MCP connection for ChatGPT,
          Claude, Claude Code, or other external assistants.
        </p>

        <div className="mt-8 rounded-xl border border-border bg-card p-5">
          <div className="flex gap-3">
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-semibold">About the internal endpoint</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                An internal metadata endpoint may exist while this work is in development. It is not
                an installable MCP server and should not be added to an assistant.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/apps"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            View available apps
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            to="/contact-support"
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Contact support
          </Link>
        </div>
      </main>
    </PublicShell>
  );
}
