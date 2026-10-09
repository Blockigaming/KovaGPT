/* eslint-disable react-refresh/only-export-components -- offline fixture without HMR */
import { useSyncExternalStore, type ReactNode } from "react";
import { account, fixtureUser, setReviewAccount, subscribe, snapshot } from "./state";
export const clerkEnabled = true;
export function ClerkProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useUser() {
  useSyncExternalStore(subscribe, snapshot);
  return {
    isLoaded: true,
    isSignedIn: account !== "guest",
    user: account === "guest" ? null : fixtureUser,
  };
}
export function useClerkSafe() {
  return {
    openUserProfile: () => globalThis.__kovaReviewNavigate?.("/sign-in"),
    openSignIn: () => globalThis.__kovaReviewNavigate?.("/sign-in"),
    openSignUp: () => globalThis.__kovaReviewNavigate?.("/sign-up"),
    signOut: async () => setReviewAccount("guest"),
    user: account === "guest" ? null : fixtureUser,
  };
}
export function useReviewAuthContext() {
  const { user, isLoaded } = useUser();
  return {
    user,
    isLoaded,
    signOut: async () => setReviewAccount("guest"),
    openAuth: (mode: "sign-in" | "sign-up") => globalThis.__kovaReviewNavigate?.("/" + mode),
  };
}
