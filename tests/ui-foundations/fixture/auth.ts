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
  return member
    ? { isLoaded: true, isSignedIn: true, user: exampleUser }
    : { isLoaded: true, isSignedIn: false, user: null };
}
export function SignInButton({ children }: { children: React.ReactNode; mode?: string }) {
  return children;
}
