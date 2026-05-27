// Clerk auth shim.
//
// Goals:
// 1) Never block initial render on Clerk loading — the page must show
//    Log in / Sign up buttons immediately even if Clerk's hosted JS is
//    slow, blocked, or unreachable (which is the case on origins that
//    aren't bound to the publishable key, e.g. preview / local dev).
// 2) Always make those buttons functional. If Clerk loads → modal opens.
//    If Clerk never loads → redirect to the production sign-in URL.
// 3) Keep the React tree (provider, hooks) identical between SSR and
//    client to avoid hydration mismatches.
import {
  ClerkProvider as RealClerkProvider,
  SignedIn,
  SignedOut,
  UserButton,
  useClerk,
  useUser as useClerkUser,
} from "@clerk/clerk-react";
import type { ReactNode } from "react";
import { Children, cloneElement, isValidElement, useEffect, useState } from "react";

// Clerk publishable keys are public and safe to embed in client code.
export const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsubm92YS1haWdwdC5sb3ZhYmxlLmFwcCQ";
const PROD_ORIGIN = "https://nova-aigpt.lovable.app";

export const clerkEnabled = true;

export function ClerkProvider({ children }: { children: ReactNode }) {
  return (
    <RealClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      {children}
    </RealClerkProvider>
  );
}

export { SignedIn, SignedOut, UserButton };

function prodAuthUrl(variant: "sign-in" | "sign-up") {
  const redirect = typeof window !== "undefined" ? window.location.href : PROD_ORIGIN;
  const path = variant === "sign-in" ? "sign-in" : "sign-up";
  return `${PROD_ORIGIN}/?${path}=1&redirect_url=${encodeURIComponent(redirect)}`;
}

function useClientOnly() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function AuthButtonWrapper({
  children,
  variant,
}: {
  children?: ReactNode;
  variant: "sign-in" | "sign-up";
}) {
  // SSR/prerender path: render the child unchanged. Clerk hooks are not
  // safe to call on the server when the SDK script hasn't initialized,
  // and the click handler is meaningless without a window anyway.
  const mounted = useClientOnly();
  if (!mounted) {
    const child = Children.only(children);
    return isValidElement(child) ? (child as React.ReactElement) : <>{child}</>;
  }
  return <AuthButtonClient variant={variant}>{children}</AuthButtonClient>;
}

function AuthButtonClient({
  children,
  variant,
}: {
  children?: ReactNode;
  variant: "sign-in" | "sign-up";
}) {
  let clerk: ReturnType<typeof useClerk> | null = null;
  let isLoaded = false;
  try {
    clerk = useClerk();
    isLoaded = useClerkUser().isLoaded;
  } catch {
    /* Clerk provider not available — fall back to redirect. */
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoaded && clerk && (clerk as any).loaded !== false) {
      try {
        if (variant === "sign-in") clerk.openSignIn();
        else clerk.openSignUp();
        return;
      } catch {
        /* fall through to redirect */
      }
    }
    if (typeof window !== "undefined") {
      window.location.href = prodAuthUrl(variant);
    }
  };

  const child = Children.only(children);
  if (isValidElement(child)) {
    return cloneElement(child as React.ReactElement<any>, { onClick: handleClick });
  }
  return (
    <button type="button" onClick={handleClick}>
      {child}
    </button>
  );
}

export function SignInButton({
  children,
  mode: _mode,
}: {
  children?: ReactNode;
  mode?: "modal" | "redirect";
}) {
  return <AuthButtonWrapper variant="sign-in">{children}</AuthButtonWrapper>;
}

export function SignUpButton({
  children,
  mode: _mode,
}: {
  children?: ReactNode;
  mode?: "modal" | "redirect";
}) {
  return <AuthButtonWrapper variant="sign-up">{children}</AuthButtonWrapper>;
}

export function useUser() {
  // Always call the same hooks in the same order, but during SSR (no window)
  // and any environment where Clerk's provider context isn't established,
  // return a deterministic signed-out state instead of letting Clerk throw.
  const mounted = useClientOnly();
  let user: ReturnType<typeof useClerkUser>["user"] = null as any;
  let isSignedIn = false;
  let isLoaded = false;
  try {
    const c = useClerkUser();
    user = c.user as any;
    isSignedIn = !!c.isSignedIn;
    isLoaded = c.isLoaded;
  } catch {
    /* Clerk not ready / no provider on server — defaults already set. */
  }
  if (!mounted) {
    return { user: null, isSignedIn: false, isLoaded: false };
  }
  if (!user) return { user: null, isSignedIn, isLoaded };
  return {
    isSignedIn,
    isLoaded,
    user: Object.assign(user, {
      email:
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses?.[0]?.emailAddress,
    }),
  };
}

// SSR-safe wrapper around Clerk's useClerk(). Returns null during SSR or
// when Clerk's provider context isn't established, so callers can do
// `useClerkSafe()?.openUserProfile()` without crashing the server render.
export function useClerkSafe() {
  const mounted = useClientOnly();
  let clerk: ReturnType<typeof useClerk> | null = null;
  try {
    clerk = useClerk();
  } catch {
    clerk = null;
  }
  return mounted ? clerk : null;
}

