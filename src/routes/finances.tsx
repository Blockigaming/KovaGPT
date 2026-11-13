import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CreditCard } from "lucide-react";
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
        tabIndex={-1}
        className="kova-page kova-secondary-page mx-auto w-full max-w-6xl px-5 py-8"
      >
        <header className="kova-finance-header">
          <Link
            to="/apps"
            className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Connections
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <CreditCard className="kova-finance-mark hidden h-7 w-7 shrink-0" aria-hidden="true" />
            <h1 className="text-3xl font-semibold">Finances</h1>
          </div>
        </header>
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
