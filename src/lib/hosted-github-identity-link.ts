import { resolveLegacyAuthContext } from "@/integrations/supabase/client";
import { SUPABASE_BROWSER_CONFIG } from "@/integrations/supabase/config";
import { getOAuthRedirectUri, rememberPostAuthRedirect } from "@/lib/oauth-session";

type Current = () => boolean;

export function validateGitHubIdentityLinkRedirect(raw: unknown, backendUrl: string): string {
  if (typeof raw !== "string" || raw.length > 8192) throw new Error("github_link_redirect_invalid");
  const url = new URL(raw);
  const callback = new URL("/auth/v1/callback", backendUrl);
  const single = (key: string) => url.searchParams.getAll(key).length === 1;
  const scopes = (url.searchParams.get("scope") ?? "").split(/[ ,]+/).filter(Boolean);
  if (
    callback.protocol !== "https:" ||
    callback.username ||
    callback.password ||
    url.origin !== "https://github.com" ||
    url.pathname !== "/login/oauth/authorize" ||
    url.username ||
    url.password ||
    url.hash ||
    !single("client_id") ||
    !url.searchParams.get("client_id") ||
    !single("state") ||
    !url.searchParams.get("state") ||
    !single("redirect_uri") ||
    url.searchParams.get("redirect_uri") !== callback.href ||
    url.searchParams.getAll("scope").length > 1 ||
    scopes.some((scope) => !["user:email", "read:user"].includes(scope))
  )
    throw new Error("github_link_redirect_invalid");
  return url.href;
}

async function verifiedContext(ownerId: string, current: Current) {
  if (!ownerId || !current()) throw new Error("github_link_owner_changed");
  const context = await resolveLegacyAuthContext();
  const assertCurrent = () => {
    context.assertCurrent();
    if (!current()) throw new Error("github_link_owner_changed");
  };
  assertCurrent();
  const { data, error } = await context.auth.getUser();
  assertCurrent();
  if (error || data.user?.id !== ownerId || !data.user.email_confirmed_at) {
    throw new Error("github_link_verified_owner_required");
  }
  return { context, user: data.user, assertCurrent };
}

export async function hostedGitHubLinkStatus(ownerId: string, current: Current) {
  const { user } = await verifiedContext(ownerId, current);
  return {
    email: user.email ?? "this account",
    linked: Boolean(user.identities?.some((identity) => identity.provider === "github")),
  };
}

export async function beginHostedGitHubIdentityLink(ownerId: string, current: Current) {
  const { context, user, assertCurrent } = await verifiedContext(ownerId, current);
  if (user.identities?.some((identity) => identity.provider === "github")) return null;
  rememberPostAuthRedirect();
  const { data, error } = await context.auth.linkIdentity({
    provider: "github",
    options: { redirectTo: getOAuthRedirectUri(), scopes: "user:email", skipBrowserRedirect: true },
  });
  assertCurrent();
  if (error) throw error;
  // linkIdentity reads the SDK's current session internally. Revalidate it
  // before redirecting, including a same-authority account switch while pending.
  await verifiedContext(ownerId, current);
  assertCurrent();
  return validateGitHubIdentityLinkRedirect(data?.url, SUPABASE_BROWSER_CONFIG.url);
}
