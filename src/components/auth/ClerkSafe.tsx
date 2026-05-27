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
import type { MouseEvent, ReactNode } from "react";
import { Children, cloneElement, isValidElement, useEffect, useState } from "react";

// Clerk publishable keys are public and safe to embed in client code.
export const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsubm92YS1haWdwdC5sb3ZhYmxlLmFwcCQ";
const PROD_ORIGIN = "https://nova-aigpt.lovable.app";
const CLERK_JS_URL = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";

export const clerkEnabled = true;

export function ClerkProvider({ children }: { children: ReactNode }) {
  return (
    <RealClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      clerkJSUrl={CLERK_JS_URL}
      afterSignOutUrl="/"
    >
      <AuthQueryParamHandler />
      {children}
    </RealClerkProvider>
  );
}

// When users land on the production origin with ?sign-in=1 or ?sign-up=1
// (e.g. redirected from the preview app where Clerk can't render its modal),
// open the corresponding Clerk modal automatically and strip the param.
function AuthQueryParamHandler() {
  const mounted = useClientOnly();
  let clerk: ReturnType<typeof useClerk> | null = null;
  let isLoaded = false;
  try {
    clerk = useClerk();
    isLoaded = useClerkUser().isLoaded;
  } catch {
    /* provider not ready */
  }
  useEffect(() => {
    if (!mounted || !isLoaded || !clerk) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantsSignIn = params.get("sign-in") === "1";
    const wantsSignUp = params.get("sign-up") === "1";
    if (!wantsSignIn && !wantsSignUp) return;
    const redirectUrl = params.get("redirect_url") || window.location.origin + "/";
    try {
      if (wantsSignIn) clerk.openSignIn({ redirectUrl, afterSignInUrl: redirectUrl });
      else clerk.openSignUp({ redirectUrl, afterSignUpUrl: redirectUrl });
    } catch {
      /* ignore */
    }
    // Clean the URL so reloads don't reopen the modal.
    params.delete("sign-in");
    params.delete("sign-up");
    params.delete("redirect_url");
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);
  }, [mounted, isLoaded, clerk]);
  return null;
}

export { SignedIn, SignedOut, UserButton };

function prodAuthUrl(variant: "sign-in" | "sign-up") {
  const redirect =
    typeof window !== "undefined" && window.location.origin === PROD_ORIGIN
      ? window.location.href
      : `${PROD_ORIGIN}/`;
  const path = variant === "sign-in" ? "sign-in" : "sign-up";
  return `${PROD_ORIGIN}/?${path}=1&redirect_url=${encodeURIComponent(redirect)}`;
}

function useClientOnly() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function callChildOnClick(child: ReactNode, event: MouseEvent<HTMLElement>) {
  if (!isValidElement(child)) return;
  const props = (child as React.ReactElement<any>).props as { onClick?: (e: MouseEvent<HTMLElement>) => void };
  props.onClick?.(event);
}

function AuthButtonWrapper({
  children,
  variant,
}: {
  children?: ReactNode;
  variant: "sign-in" | "sign-up";
}) {
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

  const href = prodAuthUrl(variant);

  const handleClick = (e: React.MouseEvent) => {
    callChildOnClick(children, e as MouseEvent<HTMLElement>);
    if (e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    const onProd =
      typeof window !== "undefined" && window.location.origin === PROD_ORIGIN;
    // The Clerk publishable key is bound to the production origin, so the
    // modal only works there. On preview / dev origins, always redirect.
    if (onProd && isLoaded && clerk && (clerk as any).loaded !== false) {
      try {
        if (variant === "sign-in") clerk.openSignIn();
        else clerk.openSignUp();
        return;
      } catch {
        /* fall through to redirect */
      }
    }
    if (typeof window !== "undefined") {
      window.location.assign(href);
    }
  };

  const child = Children.only(children);
  if (isValidElement(child)) {
    const element = child as React.ReactElement<any>;
    if (typeof element.type === "string" && element.type === "button") {
      return (
        <a
          href={href}
          onClick={handleClick}
          className={element.props.className}
          role="button"
          aria-label={element.props["aria-label"]}
        >
          {element.props.children}
        </a>
      );
    }
    return cloneElement(element, { ...element.props, onClick: handleClick });
  }
  return (
    <a href={href} onClick={handleClick}>
      {child}
    </a>
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

