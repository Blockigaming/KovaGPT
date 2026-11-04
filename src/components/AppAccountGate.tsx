import { lazy, Suspense, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useUser } from "@/components/auth/ClerkSafe";
import { requiresAppAccount } from "@/lib/app-access-policy.mjs";

const AccountWelcome = lazy(() => import("./AccountWelcome"));
function SessionLoading() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh bg-background"
      aria-busy="true"
      aria-label="Loading workspace"
    >
      <aside
        className="hidden w-64 shrink-0 rounded-r-3xl border-r border-border p-5 md:block"
        aria-hidden="true"
      >
        <div className="mb-10 h-8 w-28 animate-pulse rounded-lg bg-muted" />
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="mb-4 h-9 animate-pulse rounded-xl bg-muted" />
        ))}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col justify-end p-6" aria-hidden="true">
        <div className="mx-auto mb-6 h-32 w-full max-w-3xl animate-pulse rounded-3xl border border-border bg-muted/30" />
      </section>
    </main>
  );
}
export function AppAccountGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { isLoaded, isSignedIn } = useUser();
  if (!requiresAppAccount(pathname) || (isLoaded && isSignedIn)) return children;
  if (!isLoaded) return <SessionLoading />;
  return (
    <Suspense fallback={<SessionLoading />}>
      <AccountWelcome pending={!isLoaded} />
    </Suspense>
  );
}
