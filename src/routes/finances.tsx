import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { BankConnectionsPanel } from "@/components/BankConnectionsPanel";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/finances")({
  head: () => ({ meta: [{ title: "Finances · KovaGPT" }, { name: "robots", content: "noindex" }] }),
  component: FinancesPage,
});

function FinancesPage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  return (
    <AppShell>
      <main
        id="main-content"
        className="kova-page kova-secondary-page mx-auto w-full max-w-6xl px-5 py-8"
      >
        <Link to="/apps" className="text-sm text-muted-foreground hover:text-foreground">
          Back to Connections
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">Finances</h1>
        {isLoaded && !ownerId && (
          <div className="mt-4">
            <SignInButton mode="modal">
              <Button variant="outline">Sign in to connect a bank</Button>
            </SignInButton>
          </div>
        )}
        <BankConnectionsPanel key={ownerId ?? "guest"} visible ownerId={ownerId} />
      </main>
    </AppShell>
  );
}
