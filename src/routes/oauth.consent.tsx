import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { OAuthAuthorizationDetails, OAuthRedirect, Session } from "@supabase/supabase-js";
import { resolveLegacyAuthContext } from "@/integrations/supabase/client";
import { subscribeKovaAuthChanges } from "@/lib/kova-auth-browser";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { NovaLogo } from "@/components/NovaLogo";
import { Loader2 } from "lucide-react";

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: OAuthAuthorizationDetails | OAuthRedirect | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (
    id: string,
    options: { skipBrowserRedirect: true },
  ) => Promise<{
    data: OAuthRedirect | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (
    id: string,
    options: { skipBrowserRedirect: true },
  ) => Promise<{
    data: OAuthRedirect | null;
    error: { message: string } | null;
  }>;
};

function authorizationRedirect(value: unknown): URL | null {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    [...value].some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === "\\",
    )
  )
    return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash ? url : null;
  } catch {
    return null;
  }
}

type LegacyContext = Awaited<ReturnType<typeof resolveLegacyAuthContext>>;
function oauthApi(context: LegacyContext): OAuthApi | null {
  context.assertCurrent();
  const auth = context.auth as unknown as { oauth?: OAuthApi };
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
  const [context, setContext] = useState<LegacyContext | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let mounted = true;
    let current: LegacyContext | null = null;
    const unsubscribe = subscribeKovaAuthChanges(() => {
      if (!current) return;
      try {
        current.assertCurrent();
      } catch {
        if (mounted) {
          setContext(null);
          setUnavailable(true);
        }
      }
    });
    void resolveLegacyAuthContext()
      .then((value) => {
        if (!mounted) return;
        value.assertCurrent();
        current = value;
        setContext(value);
      })
      .catch(() => {
        if (mounted) setUnavailable(true);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  if (unavailable)
    return (
      <Message
        title="Authorization unavailable"
        body="This legacy app-authorization flow is unavailable for Kova-owned accounts. No access was granted."
      />
    );
  if (!context)
    return (
      <Message title="Checking account" body="Verifying which account system owns this request." />
    );
  return <LegacyConsentRoute context={context} />;
}

function LegacyConsentRoute({ context }: { context: LegacyContext }) {
  const { authorization_id } = Route.useSearch();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef<Session | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [authDialog, setAuthDialog] = useState<{ open: boolean; mode: "sign-in" | "sign-up" }>({
    open: false,
    mode: "sign-in",
  });

  useEffect(() => {
    let mounted = true;
    mountedRef.current = true;
    context.assertCurrent();
    context.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        context.assertCurrent();
        if (error) throw new Error("session_unavailable");
        sessionRef.current = data.session;
        setSession(data.session);
        setSessionLoaded(true);
      })
      .catch(() => {
        if (mounted) {
          setLoadError("Your session could not be verified.");
          setSessionLoaded(true);
        }
      });
    const { data: subscription } = context.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      try {
        context.assertCurrent();
      } catch {
        nextSession = null;
      }
      sessionRef.current = nextSession;
      setDetails(null);
      setSession(nextSession);
      setSessionLoaded(true);
    });
    return () => {
      mounted = false;
      mountedRef.current = false;
      subscription.subscription.unsubscribe();
    };
  }, [context]);

  useEffect(() => {
    if (!session || !authorization_id) return;
    let api: OAuthApi | null;
    try {
      api = oauthApi(context);
    } catch {
      setLoadError("Your account session changed. Start again.");
      return;
    }
    if (!api) {
      setLoadError("OAuth is not available on this project.");
      return;
    }
    let cancelled = false;
    api
      .getAuthorizationDetails(authorization_id)
      .then(({ data, error }) => {
        if (cancelled) return;
        context.assertCurrent();
        if (sessionRef.current?.user.id !== session.user.id) return;
        if (error) {
          setLoadError("The authorization request could not be verified.");
          return;
        }
        if (data && "redirect_url" in data) {
          setLoadError("This authorization request is already complete or no longer available.");
          return;
        }
        // Match the pinned SDK's top-level redirect_uri, authorization and user.
        // Reject incomplete evidence before a consent decision can consume it.
        if (
          !data ||
          data.authorization_id !== authorization_id ||
          data.user?.id !== session.user.id ||
          typeof data.client?.name !== "string" ||
          typeof data.scope !== "string" ||
          !authorizationRedirect(data.redirect_uri)
        ) {
          setLoadError("The authorization request could not be verified.");
          return;
        }
        setDetails(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("The authorization request could not be verified.");
      });
    return () => {
      cancelled = true;
    };
  }, [session, authorization_id, context]);

  async function decide(approve: boolean) {
    if (busyRef.current || !session || !details?.client) return;
    busyRef.current = true;
    setBusy(true);
    setDecisionError(null);
    const captured = session.user.id;
    const assertCurrent = () => {
      context.assertCurrent();
      if (!mountedRef.current || sessionRef.current?.user.id !== captured)
        throw new Error("session_changed");
    };
    try {
      assertCurrent();
      const approved = authorizationRedirect(details.redirect_uri);
      if (
        !approved ||
        details.authorization_id !== authorization_id ||
        details.user.id !== captured
      )
        throw new Error("authorization_changed");
      const current = await context.auth.getSession();
      assertCurrent();
      if (current.error || current.data.session?.user.id !== captured)
        throw new Error("session_changed");
      const api = oauthApi(context);
      if (!api) throw new Error("oauth_unavailable");
      const { data, error } = approve
        ? await api.approveAuthorization(authorization_id, { skipBrowserRedirect: true })
        : await api.denyAuthorization(authorization_id, { skipBrowserRedirect: true });
      assertCurrent();
      if (error) throw new Error("oauth_decision_failed");
      const next = authorizationRedirect(data?.redirect_url);
      if (!next) throw new Error("redirect_unavailable");
      if (
        next.origin !== approved.origin ||
        next.pathname !== approved.pathname ||
        [...approved.searchParams].some(
          ([key, value]) =>
            next.searchParams.getAll(key).length !== 1 || next.searchParams.get(key) !== value,
        )
      )
        throw new Error("redirect_invalid");
      window.location.href = next.href;
    } catch {
      if (mountedRef.current)
        setDecisionError("The connection was not confirmed. Start again from the requesting app.");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
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
    if (loadError) return <Message title="Could not verify your session" body={loadError} />;
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

  const clientName = details.client.name || "An app";
  const redirectUri = details.redirect_uri;
  const rawScopes = details.scope.trim() ? details.scope.trim().split(/\s+/u) : [];

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
          Signed in as{" "}
          <span className="text-foreground">{session.user.email ?? session.user.id}</span>
        </p>

        {redirectUri ? (
          <div className="mt-4 w-full rounded-2xl border border-border bg-card p-3 text-left">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Redirects to
            </div>
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
