// Clerk auth shim that NEVER blocks the UI.
//
// Clerk's publishable key is tied to a specific frontend API host
// (clerk.nova-aigpt.lovable.app). On any other origin (Lovable preview,
// local dev, custom subdomain, etc.) the Clerk SDK either fails to load
// or rejects the host — leaving sign-in/up buttons broken and the page
// half-rendered while everything inside <ClerkProvider /> waits.
//
// To keep the app usable everywhere, we detect at module load whether
// the current origin matches the Clerk-allowed host. If yes → real Clerk.
// If no → no-op shim components that render plain buttons which redirect
// to the production sign-in pages.
import {
  ClerkProvider as RealClerkProvider,
  SignedIn as RealSignedIn,
  SignedOut as RealSignedOut,
  SignInButton as RealSignInButton,
  SignUpButton as RealSignUpButton,
  UserButton as RealUserButton,
  useUser as useClerkUser,
} from "@clerk/clerk-react";
import type { ReactNode } from "react";

// Clerk publishable keys are public and safe to embed in client code.
export const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsubm92YS1haWdwdC5sb3ZhYmxlLmFwcCQ";
const CLERK_HOST = "clerk.nova-aigpt.lovable.app";
const PROD_ORIGIN = "https://nova-aigpt.lovable.app";

// Decide once at module load.
function detectClerkAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  // The publishable live key only works on its frontend API's parent
  // domain (and subdomains). Anywhere else, Clerk's hosted JS rejects
  // the origin.
  return host === "nova-aigpt.lovable.app" || host.endsWith(".nova-aigpt.lovable.app");
}

export const clerkEnabled = detectClerkAvailable();

function prodAuthUrl(path: "sign-in" | "sign-up") {
  const redirect = typeof window !== "undefined" ? window.location.href : PROD_ORIGIN;
  return `${PROD_ORIGIN}/?${path}=1&redirect_url=${encodeURIComponent(redirect)}`;
}

// --- Fallback shim components ---------------------------------------------
function FallbackProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function FallbackSignedIn(_: { children?: ReactNode }) {
  return null;
}
function FallbackSignedOut({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function FallbackAuthButton({
  children,
  mode: _mode,
  variant,
}: {
  children?: ReactNode;
  mode?: "modal" | "redirect";
  variant: "sign-in" | "sign-up";
}) {
  const href = typeof window !== "undefined" ? prodAuthUrl(variant) : "#";
  const handler = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") window.location.href = href;
  };
  // Clerk wraps its single child; do the same so existing JSX keeps working.
  if (children && typeof children === "object" && "type" in (children as any)) {
    const child = children as React.ReactElement<any>;
    return {
      ...child,
      props: { ...child.props, onClick: handler },
    } as React.ReactElement;
  }
  return (
    <button onClick={handler}>
      {children ?? (variant === "sign-in" ? "Log in" : "Sign up")}
    </button>
  );
}

function FallbackUserButton(_: any) {
  return null;
}

function fallbackUseUser() {
  return { user: null, isSignedIn: false, isLoaded: true };
}

// --- Public exports -------------------------------------------------------
export function ClerkProvider({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <FallbackProvider>{children}</FallbackProvider>;
  return (
    <RealClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      {children}
    </RealClerkProvider>
  );
}

export const SignedIn = clerkEnabled ? RealSignedIn : FallbackSignedIn;
export const SignedOut = clerkEnabled ? RealSignedOut : FallbackSignedOut;

export const SignInButton = clerkEnabled
  ? RealSignInButton
  : (props: any) => <FallbackAuthButton {...props} variant="sign-in" />;

export const SignUpButton = clerkEnabled
  ? RealSignUpButton
  : (props: any) => <FallbackAuthButton {...props} variant="sign-up" />;

export const UserButton = clerkEnabled ? RealUserButton : FallbackUserButton;

export function useUser() {
  if (!clerkEnabled) return fallbackUseUser();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user, isSignedIn, isLoaded } = useClerkUser();
  if (!user) return { user: null, isSignedIn: !!isSignedIn, isLoaded };
  return {
    isSignedIn: !!isSignedIn,
    isLoaded,
    user: Object.assign(user, {
      email:
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses?.[0]?.emailAddress,
    }),
  };
}
