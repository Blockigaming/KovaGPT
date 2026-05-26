// Clerk auth shim. Re-exports Clerk components and wraps useUser to add a
// convenient `email` shortcut used by pricing/checkout code.
import {
  ClerkProvider as RealClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser as useClerkUser,
} from "@clerk/clerk-react";
import type { ReactNode } from "react";

// Clerk publishable keys are public and safe to embed in client code.
export const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsubm92YS1haWdwdC5sb3ZhYmxlLmFwcCQ";

export const clerkEnabled = true;

export function ClerkProvider({ children }: { children: ReactNode }) {
  return (
    <RealClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      {children}
    </RealClerkProvider>
  );
}

export { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton };

export function useUser() {
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
