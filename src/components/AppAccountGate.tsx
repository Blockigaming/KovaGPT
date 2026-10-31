import { lazy, Suspense, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useUser } from "@/components/auth/ClerkSafe";
import { requiresAppAccount } from "@/lib/app-access-policy.mjs";

const AccountWelcome = lazy(() => import("./AccountWelcome"));
function SessionLoading() {
  return (
    <main id="main-content" className="kova-session-loading" aria-busy="true">
      <strong>KovaGPT</strong>
      <span role="status">
        <i className="kova-session-spinner" aria-hidden="true" />
        Getting your space ready…
      </span>
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
      <AccountWelcome />
    </Suspense>
  );
}
