import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useUser } from "@/components/auth/ClerkSafe";
import { safeRelativeRedirect } from "@/lib/auth-security.mjs";
import { PublicWebsiteHome } from "./PublicWebsite";

export function PublicLogin({ mode }: { mode: "sign-in" | "sign-up" }) {
  const { isLoaded, isSignedIn } = useUser();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const value = new URLSearchParams(search).get("return_to");
    const next = safeRelativeRedirect(value, window.location.origin);
    window.location.replace(/^\/(?:login|signup|auth)(?:[/?#]|$)/u.test(next) ? "/" : next);
  }, [isLoaded, isSignedIn, search]);
  return <PublicWebsiteHome mode={mode} />;
}
