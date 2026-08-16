import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { NovaLogo } from "@/components/NovaLogo";
import { Loader2 } from "lucide-react";

type AuthorizationDetails = {
  client?: {
    name?: string;
    client_name?: string;
    redirect_uri?: string;
    redirect_uris?: string[];
  } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scope?: string | null;
  scopes?: string[] | null;
};

type OAuthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
};

function oauthApi(): OAuthApi | null {
  const auth = supabase.auth as unknown as { oauth?: OAuthApi };
  return auth.oauth ?? null;
}

export const Route = createFileRoute("/oauth/consent")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    authorization_id:
      typeof search.authorization_id === "string" ? search.authorization_id.slice(0, 2048) : "",
  }),
  component: ConsentRoute,
  head: () => ({
    meta: [
      { title: "Authorize an app | KovaGPT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function ConsentRoute() {
  const { authorization_id } = Route.useSearch();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [authDialog, setAuthDialog] = useState<{ open: boolean; mode: "sign-in" | "sign-up" }>({
    open: false,
    mode: "sign-in",
  });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setSessionLoaded(true);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !authorization_id) return;
    const api = oauthApi();
    if (!api) {
      setLoadError("OAuth is not available on this project.");
      return;
    }
    let cancelled = false;
    api
      .getAuthorizationDetails(authorization_id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [session, authorization_id]);

  async function decide(approve: boolean) {
    const api = oauthApi();
    if (!api) return;
    setBusy(true);
    setDecisionError(null);
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setDecisionError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setDecisionError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (!authorization_id) {
    return <Message title="Invalid request" body="Missing authorization_id." />;
  }

  if (!sessionLoaded) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading
        </div>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/[0.04] ring-1 ring-border">
            <NovaLogo className="h-9 w-9" />
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight">Sign in to continue</h1>
          <p className="mt-2 max-w-[320px] text-sm text-muted-foreground">
            An app is requesting access to your KovaGPT account. Sign in to review and approve the
            request.
          </p>
          <div className="mt-6 flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={() => setAuthDialog({ open: true, mode: "sign-up" })}
              className="h-12 w-full rounded-2xl bg-foreground font-medium text-background transition hover:opacity-90"
            >
              Create account
            </button>
            <button
              type="button"
              onClick={() => setAuthDialog({ open: true, mode: "sign-in" })}
              className="h-12 w-full rounded-2xl border border-border font-medium transition hover:bg-accent"
            >
              Log in
            </button>
          </div>
        </div>
        <AuthDialog
          open={authDialog.open}
          mode={authDialog.mode}
          onOpenChange={(open) => setAuthDialog((state) => ({ ...state, open }))}
        />
      </Shell>
    );
  }

  if (loadError) {
    return <Message title="Could not load this authorization" body={loadError} />;
  }

  if (!details) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading request
        </div>
      </Shell>
    );
  }

  const clientName = details.client?.name ?? details.client?.client_name ?? "An app";
  const redirectUri =
    details.client?.redirect_uri ??
    (details.client?.redirect_uris && details.client.redirect_uris[0]) ??
    null;
  const rawScopes =
    details.scopes ??
    (typeof details.scope === "string" && details.scope.length ? details.scope.split(/\s+/u) : []);

  return (
    <Shell>
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/[0.04] ring-1 ring-border">
          <NovaLogo className="h-9 w-9" />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          Connect {clientName} to KovaGPT
        </h1>
        <p className="mt-2 max-w-[340px] text-sm text-muted-foreground">
          This lets {clientName} use KovaGPT as you. Your KovaGPT permissions and backend policies
          still decide what it can read or change.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Signed in as <span className="text-foreground">{session.user.email ?? session.user.id}</span>
        </p>

        {redirectUri ? (
          <div className="mt-4 w-full rounded-2xl border border-border bg-card p-3 text-left">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Redirects to</div>
            <div className="mt-1 break-all text-[13px]">{redirectUri}</div>
          </div>
        ) : null}

        {rawScopes.length > 0 ? (
          <div className="mt-3 w-full rounded-2xl border border-border bg-card p-3 text-left">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Requested access
            </div>
            <ul className="mt-1 space-y-1 text-[13px]">
              {rawScopes.map((scope) => (
                <li key={scope}>{scopeLabel(scope)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {decisionError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {decisionError}
          </p>
        ) : null}

        <div className="mt-6 flex w-full flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide(true)}
            className="h-12 w-full rounded-2xl bg-foreground font-medium text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Working" : "Approve"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide(false)}
            className="h-12 w-full rounded-2xl border border-border font-medium transition hover:bg-accent disabled:opacity-60"
          >
            Cancel connection
          </button>
        </div>
      </div>
    </Shell>
  );
}

function scopeLabel(scope: string) {
  switch (scope) {
    case "openid":
      return "Confirm your KovaGPT identity";
    case "email":
      return "Share your email address";
    case "profile":
      return "Share your basic profile";
    default:
      return `Additional permission: ${scope}`;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[440px] rounded-3xl border border-border bg-card p-8 shadow-2xl">
        {children}
      </div>
    </main>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </Shell>
  );
}
