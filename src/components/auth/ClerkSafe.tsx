// Auth shim backed by Supabase auth.
//
// Historically this file wrapped Clerk; consumers across the app import
// `useUser`, `SignInButton`, `SignUpButton`, `UserButton`, `SignedIn`,
// `SignedOut`, `ClerkProvider`, and `useClerkSafe` from here. We preserve
// those exports so the rest of the app keeps working unchanged, but the
// underlying implementation now uses Supabase auth (email/password + Google)
// and renders a local <AuthDialog> for sign in/up.

import {
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { getSupabaseClientConfigStatus, supabase } from "@/integrations/supabase/client";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { MfaChallengeDialog } from "@/components/auth/MfaChallengeDialog";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";
import {
  clearOAuthResponseFromUrl,
  completeOAuthSessionFromUrl,
  hasOAuthResponseInUrl,
  markPasswordRecoveryFlow,
  OAUTH_CALLBACK_PATH,
} from "@/lib/oauth-session";
import {
  clearPrincipalBrowserStorage,
  dispatchPrincipalBrowserStorageCleared,
  purgeUnscopedPrivateBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";
import {
  classifyAuthValidationResult,
  classifySessionRestoreError,
  classifyThrownAuthValidationError,
  isCurrentAuthValidation,
  retryableAuthPrincipalState,
} from "@/lib/auth-validation-policy.mjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User as UserIcon } from "lucide-react";

export const clerkEnabled = true;

type AuthDialogState = { open: boolean; mode: "sign-in" | "sign-up" };
type AuthIssue = "temporarily_unavailable" | "configuration_unavailable" | null;

type AuthCtx = {
  session: Session | null;
  user: SupabaseUser | null;
  isLoaded: boolean;
  authIssue: AuthIssue;
  openAuth: (mode: "sign-in" | "sign-up") => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

function isActiveBan(bannedUntil: string | undefined) {
  if (!bannedUntil) return false;
  const timestamp = Date.parse(bannedUntil);
  return !Number.isFinite(timestamp) || timestamp > Date.now();
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pendingMfaSession, setPendingMfaSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [authIssue, setAuthIssue] = useState<AuthIssue>(null);
  const [dialog, setDialog] = useState<AuthDialogState>({
    open: false,
    mode: "sign-in",
  });
  const authReturnFocusRef = useRef<HTMLElement | null>(null);
  const sessionValidationRef = useRef(0);
  // `undefined` is unresolved, `null` is a confirmed guest, and a string is a
  // validated account.
  const browserStorageUserIdRef = useRef<string | null | undefined>(undefined);
  // `undefined` means there is no account awaiting validation. Keep this
  // distinct from `null`, which is the real guest principal understood by the
  // storage cleanup helpers.
  const pendingValidationUserIdRef = useRef<string | undefined>(undefined);
  const validatedSessionRef = useRef<Session | null>(null);

  const clearBrowserStateFor = useCallback((...userIds: (string | null | undefined)[]) => {
    const seen = new Set<string>();
    for (const userId of userIds) {
      if (userId === undefined) continue;
      const identityKey = userId === null ? "guest" : `user:${userId}`;
      if (seen.has(identityKey)) continue;
      seen.add(identityKey);
      const result = clearPrincipalBrowserStorage(userId);
      const failureCount = result.local.failures.length + result.session.failures.length;
      if (failureCount > 0) {
        console.warn("[KovaAuth] Account-local browser cleanup was incomplete", {
          failureCount,
        });
      }
      dispatchPrincipalBrowserStorageCleared(userId);
    }
  }, []);

  const purgeOwnerlessStateFor = useCallback((userId: string | null) => {
    const result = purgeUnscopedPrivateBrowserStorage(userId);
    const failureCount = result.local.failures.length + result.session.failures.length;
    if (failureCount > 0) {
      console.warn("[KovaAuth] Transitional browser cleanup was incomplete", {
        failureCount,
      });
    }
    dispatchPrincipalBrowserStorageCleared(userId);
  }, []);

  const markRetryableAuthFailure = useCallback(
    (candidate: Session | null, error: unknown, source: "returned" | "thrown" | "restore") => {
      const candidateUserId = candidate?.user.id ?? null;
      if (candidateUserId) pendingValidationUserIdRef.current = candidateUserId;
      const principalState = retryableAuthPrincipalState(
        candidateUserId,
        browserStorageUserIdRef.current,
      );
      const retainedSession =
        principalState.principalResolution === "authenticated" &&
        validatedSessionRef.current?.user.id === principalState.userId
          ? validatedSessionRef.current
          : null;
      const errorName =
        error && typeof error === "object" && "name" in error
          ? String((error as { name?: unknown }).name ?? "unknown_error")
          : "unknown_error";

      console.error("[KovaAuth] Session validation is temporarily unavailable", {
        source,
        error: errorName,
      });
      // Retryable auth is never a confirmed guest and never destructive. A
      // previously validated same-user session may remain available offline;
      // initial and account-switch failures stay principal-unresolved.
      setPendingMfaSession(null);
      setAuthIssue("temporarily_unavailable");
      setSession(retainedSession);
      setIsLoaded(Boolean(retainedSession));
    },
    [],
  );

  const acceptSession = useCallback(
    async (candidate: Session | null) => {
      const validation = ++sessionValidationRef.current;
      if (!candidate) {
        const previousUserId = browserStorageUserIdRef.current;
        const pendingUserId = pendingValidationUserIdRef.current;
        if (typeof previousUserId === "string" || pendingUserId) {
          // Gate mounted account stores before durable cleanup.
          setSession(null);
          setPendingMfaSession(null);
          setIsLoaded(false);
        }
        clearBrowserStateFor(
          typeof previousUserId === "string" ? previousUserId : undefined,
          pendingUserId,
        );
        // First resolution and authenticated-to-guest transitions remove only
        // ownerless transitional data, never separately scoped guest data.
        if (previousUserId !== null || pendingUserId) purgeOwnerlessStateFor(null);
        browserStorageUserIdRef.current = null;
        pendingValidationUserIdRef.current = undefined;
        validatedSessionRef.current = null;
        setSession(null);
        setPendingMfaSession(null);
        setAuthIssue(null);
        setIsLoaded(true);
        return;
      }

      pendingValidationUserIdRef.current = candidate.user.id;
      if (
        browserStorageUserIdRef.current &&
        browserStorageUserIdRef.current !== candidate.user.id
      ) {
        // Hide the previous account while a different principal is validated.
        setSession(null);
        setIsLoaded(false);
      }

      try {
        const [{ data: userData, error: userError }, { data: assurance, error: assuranceError }] =
          await Promise.all([
            supabase.auth.getUser(candidate.access_token),
            supabase.auth.mfa.getAuthenticatorAssuranceLevel(candidate.access_token),
          ]);
        if (validation !== sessionValidationRef.current) return;

        const validatedUser = userData.user;
        const disposition = classifyAuthValidationResult({
          userError,
          assuranceError,
          userPresent: Boolean(validatedUser),
          userIdMatches: !validatedUser || validatedUser.id === candidate.user.id,
          userDeleted: Boolean(validatedUser?.deleted_at),
          userBanned: isActiveBan(validatedUser?.banned_until),
        });
        if (disposition.kind === "retryable") {
          markRetryableAuthFailure(candidate, userError ?? assuranceError, "returned");
          return;
        }
        if (disposition.kind === "terminal") {
          console.error("[KovaAuth] Session validation failed", {
            userStatus: userError ? "invalid" : validatedUser ? "invalid" : "missing",
            assuranceStatus: assuranceError ? "unavailable" : "valid",
          });
          setSession(null);
          setPendingMfaSession(null);
          setIsLoaded(false);
          const cleanupIds = [
            browserStorageUserIdRef.current,
            pendingValidationUserIdRef.current,
            candidate.user.id,
          ] as const;
          clearBrowserStateFor(...cleanupIds);
          await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
          if (validation !== sessionValidationRef.current) return;
          clearBrowserStateFor(...cleanupIds);
          purgeOwnerlessStateFor(null);
          browserStorageUserIdRef.current = null;
          pendingValidationUserIdRef.current = undefined;
          validatedSessionRef.current = null;
          setSession(null);
          setPendingMfaSession(null);
          setAuthIssue(null);
          setIsLoaded(true);
          return;
        }
        if (!validatedUser || !assurance) return;

        if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
          if (
            browserStorageUserIdRef.current &&
            browserStorageUserIdRef.current !== candidate.user.id
          ) {
            clearBrowserStateFor(browserStorageUserIdRef.current);
          }
          if (browserStorageUserIdRef.current !== validatedUser.id) {
            purgeOwnerlessStateFor(validatedUser.id);
          }
          browserStorageUserIdRef.current = validatedUser.id;
          pendingValidationUserIdRef.current = undefined;
          validatedSessionRef.current = null;
          setSession(null);
          setPendingMfaSession(candidate);
          setDialog((current) => ({ ...current, open: false }));
          setAuthIssue(null);
          // MFA identity is known, but storage stays unresolved until the
          // challenge succeeds so no caller can fall back to guest.
          setIsLoaded(false);
          return;
        }

        if (
          browserStorageUserIdRef.current &&
          browserStorageUserIdRef.current !== validatedUser.id
        ) {
          clearBrowserStateFor(browserStorageUserIdRef.current);
        }
        if (browserStorageUserIdRef.current !== validatedUser.id) {
          purgeOwnerlessStateFor(validatedUser.id);
        }
        const validatedSession = { ...candidate, user: validatedUser };
        browserStorageUserIdRef.current = validatedUser.id;
        pendingValidationUserIdRef.current = undefined;
        validatedSessionRef.current = validatedSession;
        setPendingMfaSession(null);
        setSession(validatedSession);
        setAuthIssue(null);
        setIsLoaded(true);
      } catch (error) {
        if (validation !== sessionValidationRef.current) return;
        const disposition = classifyThrownAuthValidationError(error);
        if (disposition.kind === "retryable") {
          markRetryableAuthFailure(candidate, error, "thrown");
        }
      }
    },
    [clearBrowserStateFor, markRetryableAuthFailure, purgeOwnerlessStateFor],
  );

  useEffect(() => {
    // Register listener first so we capture the SIGNED_IN that fires when
    // setSession() persists the OAuth tokens below. Missing Supabase browser
    // config must not take down the public homepage; auth becomes unavailable
    // until deployment config is repaired.
    let cancelled = false;
    const config = getSupabaseClientConfigStatus();
    if (!config.configured) {
      console.warn(`[KovaAuth] Supabase auth unavailable. Missing: ${config.missing.join(", ")}`);
      setSession(null);
      setAuthIssue("configuration_unavailable");
      // Missing deployment config cannot prove that this browser is a guest.
      setIsLoaded(false);
      return () => {
        cancelled = true;
      };
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return;
      if (!newSession && hasOAuthResponseInUrl()) return;
      if (event === "PASSWORD_RECOVERY" && newSession) {
        markPasswordRecoveryFlow(newSession.user.id);
      }
      // Invalidate hydration and older queued events synchronously. Deferring
      // the validation itself must not leave a window where stale getSession()
      // success can commit first (especially a destructive null session).
      const eventValidation = ++sessionValidationRef.current;
      // Supabase warns against awaiting auth methods while its auth-state lock
      // is held. Schedule the authoritative user/MFA validation after this
      // callback returns.
      window.setTimeout(() => {
        if (isCurrentAuthValidation(eventValidation, sessionValidationRef.current, cancelled)) {
          void acceptSession(newSession);
        }
      }, 0);
    });

    async function hydrateSession() {
      const hydrationValidation = sessionValidationRef.current;
      try {
        if (hasOAuthResponseInUrl() && window.location.pathname !== OAUTH_CALLBACK_PATH) {
          // Clear the OAuth params from the URL up-front so a StrictMode
          // double-invoke / reload can't re-trigger exchange.
          const oauthSession = await completeOAuthSessionFromUrl("app bootstrap");
          clearOAuthResponseFromUrl();
          if (
            !isCurrentAuthValidation(hydrationValidation, sessionValidationRef.current, cancelled)
          )
            return;
          if (oauthSession) {
            await acceptSession(oauthSession);
            return;
          }
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) {
          if (
            isCurrentAuthValidation(hydrationValidation, sessionValidationRef.current, cancelled)
          ) {
            const disposition = classifySessionRestoreError(error);
            if (disposition.kind === "terminal") {
              const cleanupIds = [
                browserStorageUserIdRef.current,
                pendingValidationUserIdRef.current,
                undefined,
              ] as const;
              setSession(null);
              setPendingMfaSession(null);
              setIsLoaded(false);
              clearBrowserStateFor(...cleanupIds);
              await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
              if (
                !isCurrentAuthValidation(
                  hydrationValidation,
                  sessionValidationRef.current,
                  cancelled,
                )
              )
                return;
              clearBrowserStateFor(...cleanupIds);
              purgeOwnerlessStateFor(null);
              browserStorageUserIdRef.current = null;
              pendingValidationUserIdRef.current = undefined;
              validatedSessionRef.current = null;
              setAuthIssue(null);
              setIsLoaded(true);
            } else {
              markRetryableAuthFailure(data.session, error, "restore");
            }
          }
          return;
        }
        if (!isCurrentAuthValidation(hydrationValidation, sessionValidationRef.current, cancelled))
          return;
        await acceptSession(data.session);
      } catch (error) {
        if (isCurrentAuthValidation(hydrationValidation, sessionValidationRef.current, cancelled)) {
          markRetryableAuthFailure(null, error, "restore");
        }
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [acceptSession, clearBrowserStateFor, markRetryableAuthFailure, purgeOwnerlessStateFor]);

  // Support ?sign-in=1 / ?sign-up=1 deep links (legacy behavior).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantsSignIn = params.get("sign-in") === "1";
    const wantsSignUp = params.get("sign-up") === "1";
    if (!wantsSignIn && !wantsSignUp) return;
    setDialog({ open: true, mode: wantsSignUp ? "sign-up" : "sign-in" });
    params.delete("sign-in");
    params.delete("sign-up");
    params.delete("redirect_url");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
  }, []);

  const openAuth = useCallback((mode: "sign-in" | "sign-up") => {
    authReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog({ open: true, mode });
  }, []);

  const signOut = useCallback(async () => {
    // Normal sign-out is intentionally device-local. "Sign out other
    // sessions" remains a separate, explicit security action.
    const browserStorageUserId = browserStorageUserIdRef.current;
    const pendingValidationUserId = pendingValidationUserIdRef.current;
    sessionValidationRef.current += 1;
    setSession(null);
    setPendingMfaSession(null);
    setIsLoaded(false);
    clearBrowserStateFor(browserStorageUserId, pendingValidationUserId);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    clearBrowserStateFor(browserStorageUserId, pendingValidationUserId);
    purgeOwnerlessStateFor(null);
    browserStorageUserIdRef.current = null;
    pendingValidationUserIdRef.current = undefined;
    validatedSessionRef.current = null;
    setSession(null);
    setPendingMfaSession(null);
    setAuthIssue(null);
    setIsLoaded(true);
    // Hard reload drops any in-memory React-Query / router caches too.
    if (typeof window !== "undefined") window.location.assign("/");
  }, [clearBrowserStateFor, purgeOwnerlessStateFor]);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoaded,
      authIssue,
      openAuth,
      signOut,
    }),
    [session, isLoaded, authIssue, openAuth, signOut],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {authIssue ? (
        <div
          role="alert"
          className="fixed left-1/2 top-4 z-[120] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
        >
          <span>
            {authIssue === "configuration_unavailable"
              ? "Sign-in is temporarily unavailable because authentication is not configured."
              : "KovaGPT could not verify your session. Your browser data was not changed."}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-border px-2.5 py-1 font-medium hover:bg-accent"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      ) : null}
      <AuthDialog
        open={dialog.open}
        mode={dialog.mode}
        returnFocusTarget={authReturnFocusRef.current}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <MfaChallengeDialog
        open={Boolean(pendingMfaSession)}
        onVerified={(verifiedSession) => void acceptSession(verifiedSession)}
        onCancel={() => void signOut()}
      />
    </Ctx.Provider>
  );
}

function useAuthCtx(): AuthCtx {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // Safe fallback for SSR / out-of-provider usage.
  return {
    session: null,
    user: null,
    isLoaded: false,
    authIssue: null,
    openAuth: () => {},
    signOut: async () => {},
  };
}

// ---- Hook compat surface --------------------------------------------------

type UserShape = {
  id: string;
  email?: string;
  firstName?: string | null;
  fullName?: string | null;
  imageUrl?: string | null;
  username?: string | null;
  primaryEmailAddress?: { emailAddress?: string };
  emailAddresses?: Array<{ emailAddress?: string }>;
} | null;

function adaptUser(u: SupabaseUser | null): UserShape {
  if (!u) return null;
  const email = u.email ?? undefined;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null;
  const firstName = fullName ? fullName.split(" ")[0] : null;
  const imageUrl =
    (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined) ?? null;
  return {
    id: u.id,
    email,
    firstName,
    fullName,
    username:
      (meta.user_name as string | undefined) ??
      (meta.preferred_username as string | undefined) ??
      null,
    imageUrl,
    primaryEmailAddress: email ? { emailAddress: email } : undefined,
    emailAddresses: email ? [{ emailAddress: email }] : [],
  };
}

export function useUser() {
  const { user, isLoaded, authIssue } = useAuthCtx();
  const adapted = adaptUser(user);
  return { user: adapted, isSignedIn: !!user, isLoaded, authError: authIssue };
}

// Compat with previous `useClerkSafe()?.openUserProfile()` / openSignIn /
// signOut callsites.
export function useClerkSafe() {
  const { openAuth, signOut } = useAuthCtx();
  return {
    openUserProfile: () => openAuth("sign-in"),
    openSignIn: () => openAuth("sign-in"),
    openSignUp: () => openAuth("sign-up"),
    signOut: () => signOut(),
  };
}

// ---- Button / gate components --------------------------------------------

export function SignedIn({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useAuthCtx();
  if (!isLoaded || !user) return null;
  return <>{children}</>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useAuthCtx();
  if (!isLoaded || user) return null;
  return <>{children}</>;
}

function AuthTrigger({
  children,
  variant,
}: {
  children?: ReactNode;
  variant: "sign-in" | "sign-up";
}) {
  const { openAuth } = useAuthCtx();
  const handleClick = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    openAuth(variant);
  };

  if (isValidElement(children)) {
    const child = children as ReactElement<{
      onClick?: (e: MouseEvent<HTMLElement>) => void;
    }>;

    return cloneElement(child, {
      onClick: (e: MouseEvent<HTMLElement>) => {
        child.props.onClick?.(e);
        if (e.defaultPrevented) return;
        handleClick(e);
      },
    });
  }

  return (
    <button type="button" onClick={handleClick}>
      {children ?? (variant === "sign-in" ? "Log in" : "Sign up")}
    </button>
  );
}

export function SignInButton({ children }: { children?: ReactNode; mode?: "modal" | "redirect" }) {
  return <AuthTrigger variant="sign-in">{children}</AuthTrigger>;
}

export function SignUpButton({ children }: { children?: ReactNode; mode?: "modal" | "redirect" }) {
  return <AuthTrigger variant="sign-up">{children}</AuthTrigger>;
}

// ---- UserButton -----------------------------------------------------------

export function UserButton(_props?: {
  afterSignOutUrl?: string;
  appearance?: { elements?: { avatarBox?: string } };
}) {
  const { user, signOut } = useAuthCtx();
  const adapted = adaptUser(user);
  const avatar = adapted?.imageUrl;
  const label = adapted?.fullName || adapted?.email || "Account";
  const initial = (adapted?.fullName || adapted?.email || "?").trim().charAt(0).toUpperCase();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xs font-medium text-foreground hover:opacity-90"
          aria-label="Account menu"
        >
          {avatar ? (
            <img src={avatar} alt={label} className="h-full w-full object-cover" />
          ) : (
            <span>{initial}</span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
          {adapted?.email && adapted.email !== label && (
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
              {adapted.email}
            </DropdownMenuLabel>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("kova-open-settings", {
                    detail: { tab: "general" },
                  }),
                );
              }
            }}
          >
            <UserIcon className="mr-2 h-4 w-4" /> Profile &amp; settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LogoutConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => signOut()}
      />
    </>
  );
}
