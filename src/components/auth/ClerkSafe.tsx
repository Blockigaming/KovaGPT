// Wrapper that no-ops when Clerk publishable key isn't configured.
import {
  ClerkProvider as RealClerkProvider,
  SignedIn as RealSignedIn,
  SignedOut as RealSignedOut,
  SignInButton as RealSignInButton,
  SignUpButton as RealSignUpButton,
  UserButton as RealUserButton,
  useUser as realUseUser,
} from "@clerk/clerk-react";
import type { ReactNode } from "react";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export const clerkEnabled = !!PUBLISHABLE_KEY;

export function ClerkProvider({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <>{children}</>;
  return (
    <RealClerkProvider
      publishableKey={PUBLISHABLE_KEY!}
      appearance={{
        variables: {
          colorPrimary: "oklch(0.7 0.18 280)",
          colorBackground: "oklch(0.24 0.006 285)",
          colorText: "oklch(0.96 0 0)",
          colorInputBackground: "oklch(0.28 0.006 285)",
          colorInputText: "oklch(0.96 0 0)",
          colorTextSecondary: "oklch(0.7 0.01 285)",
          borderRadius: "0.75rem",
        },
      }}
    >
      {children}
    </RealClerkProvider>
  );
}

export function SignedIn({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return null;
  return <RealSignedIn>{children}</RealSignedIn>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <>{children}</>;
  return <RealSignedOut>{children}</RealSignedOut>;
}

function notConfigured() {
  alert(
    "Authentication isn't configured yet.\n\nAdd VITE_CLERK_PUBLISHABLE_KEY as a Build Secret in Workspace Settings to enable login.",
  );
}

export function SignInButton({ children, mode }: { children: ReactNode; mode?: "modal" | "redirect" }) {
  if (!clerkEnabled) {
    return (
      <span onClick={notConfigured} style={{ display: "contents", cursor: "pointer" }}>
        {children}
      </span>
    );
  }
  return <RealSignInButton mode={mode}>{children}</RealSignInButton>;
}

export function SignUpButton({ children, mode }: { children: ReactNode; mode?: "modal" | "redirect" }) {
  if (!clerkEnabled) return <SignInButton mode={mode}>{children}</SignInButton>;
  return <RealSignUpButton mode={mode}>{children}</RealSignUpButton>;
}

export function UserButton() {
  if (!clerkEnabled) return null;
  return <RealUserButton afterSignOutUrl="/" />;
}

export function useUser() {
  if (!clerkEnabled) {
    return { isSignedIn: false as const, user: null, isLoaded: true };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return realUseUser();
}
