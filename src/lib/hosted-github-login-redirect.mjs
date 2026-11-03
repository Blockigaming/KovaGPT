/**
 * Accept only the expected hosted Auth endpoint, never a connector OAuth URL
 * or a redirect supplied by unrelated content.
 */
export function validateHostedGitHubLoginRedirect(raw, supabaseUrl) {
  if (typeof raw !== "string" || raw.length > 4096 || typeof supabaseUrl !== "string") {
    throw new Error("github_login_redirect_invalid");
  }
  let destination;
  let authority;
  try {
    destination = new URL(raw);
    authority = new URL(supabaseUrl);
  } catch {
    throw new Error("github_login_redirect_invalid");
  }
  if (
    destination.protocol !== "https:" ||
    authority.protocol !== "https:" ||
    destination.origin !== authority.origin ||
    destination.pathname !== "/auth/v1/authorize" ||
    destination.searchParams.getAll("provider").length !== 1 ||
    destination.searchParams.get("provider") !== "github" ||
    destination.username ||
    destination.password ||
    destination.hash
  ) {
    throw new Error("github_login_redirect_invalid");
  }
  return destination.toString();
}
