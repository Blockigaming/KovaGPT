import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { WorkspacePageHeader } from "@/components/WorkspacePageHeader";
import { WorkSessionPanel } from "@/components/WorkSessionPanel";
import { WorkSyncStatus } from "@/components/WorkSyncStatus";
import { Button } from "@/components/ui/button";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";

export const Route = createFileRoute("/work")({
  head: () => ({
    meta: [{ title: "KovaGPT Work" }, { name: "robots", content: "noindex" }],
  }),
  component: WorkPage,
});

function WorkPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  return (
    <AppShell>
      <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <WorkspacePageHeader
          title="Work"
          titleId="work-title"
          description="Plan a task, choose a Project and model, and review actions as Kova works."
        />
        {!isLoaded ? (
          <p role="status" className="mt-6 text-sm text-muted-foreground">
            Loading your account…
          </p>
        ) : ownerId ? (
          <section key={ownerId} aria-label="Your Work">
            <WorkSyncStatus />
            <WorkSessionPanel ownerId={ownerId} prepared={null} />
          </section>
        ) : (
          <section aria-label="Sign in to Work" className="mt-6 rounded-2xl border bg-card p-6">
            <h2 className="text-lg font-semibold">Keep your work in your account</h2>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              Sign in to prepare plans and review your tasks. Execution requires an eligible plan
              and verified account. Nothing starts until you submit it.
            </p>
            <SignInButton mode="modal">
              <Button>Log in</Button>
            </SignInButton>
          </section>
        )}
      </main>
    </AppShell>
  );
}
