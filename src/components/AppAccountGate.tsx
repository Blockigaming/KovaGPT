import { lazy, Suspense, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useUser } from "@/components/auth/ClerkSafe";
import { requiresAppAccount } from "@/lib/app-access-policy.mjs";

const AccountWelcome = lazy(() => import("./AccountWelcome"));
function SessionLoading() {
  // Protected data remains gated until auth resolves. The page structure is
  // visible immediately instead of hiding everything behind a loading cover.
  return (
    <div className="kova-session-shell" aria-busy="true">
      <aside className="kova-session-shell-sidebar" aria-hidden="true">
        <strong>KovaGPT</strong>
        <div className="kova-session-skeleton kova-session-nav-wide" />
        <div className="kova-session-skeleton kova-session-nav-short" />
        <div className="kova-session-skeleton kova-session-nav-wide" />
      </aside>
      <main id="main-content" className="kova-session-shell-main">
        <header className="kova-session-shell-header" aria-hidden="true">
          <span className="kova-session-skeleton kova-session-header-title" />
          <span className="kova-session-skeleton kova-session-header-action" />
        </header>
        <div className="kova-session-shell-body">
          <p role="status">Checking your account…</p>
          <div className="kova-session-skeleton kova-session-content-line" aria-hidden="true" />
          <div
            className="kova-session-skeleton kova-session-content-line-short"
            aria-hidden="true"
          />
          <div
            className="kova-session-skeleton kova-session-composer-placeholder"
            aria-hidden="true"
          />
        </div>
      </main>
    </div>
  );
}
export function AppAccountGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { isLoaded, isSignedIn } = useUser();
  if (!requiresAppAccount(pathname) || (isLoaded && isSignedIn)) return children;
  if (!isLoaded && pathname !== "/") return <SessionLoading />;
  return (
    <Suspense fallback={<SessionLoading />}>
      <AccountWelcome pending={!isLoaded} />
    </Suspense>
  );
}
