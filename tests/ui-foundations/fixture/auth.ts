import type { ReactNode } from "react";

// Isolated presentation identities only. No auth/backend module or credentials.
const exampleUser = {
  id: "workspace-example",
  fullName: "Example account",
  firstName: "Example",
  username: "example",
  email: "example@example.invalid",
  imageUrl: "",
};
export const clerkEnabled = true;
export function useUser() {
  const member = new URLSearchParams(location.search).get("session") === "member";
  return { isLoaded: true, isSignedIn: member, user: member ? exampleUser : null };
}
export function SignInButton({ children }: { children: ReactNode; mode?: string }) {
  return children;
}
