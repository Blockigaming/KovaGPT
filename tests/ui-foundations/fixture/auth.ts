// This isolated browser fixture represents a guest. It cannot authenticate,
// acquire credentials, or import the production auth/backend module.
export function useUser() {
  return { isLoaded: true, isSignedIn: false, user: null };
}
