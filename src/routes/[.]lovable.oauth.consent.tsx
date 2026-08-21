import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    authorization_id:
      typeof search.authorization_id === "string" ? search.authorization_id.slice(0, 2048) : "",
  }),
  component: LegacyConsentRedirect,
});

function LegacyConsentRedirect() {
  const { authorization_id } = Route.useSearch();

  useEffect(() => {
    const target = new URL("/oauth/consent", window.location.origin);
    if (authorization_id) target.searchParams.set("authorization_id", authorization_id);
    window.location.replace(target.toString());
  }, [authorization_id]);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 text-foreground">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Redirecting authorization request
      </div>
    </main>
  );
}
