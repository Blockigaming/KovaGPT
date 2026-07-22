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
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { getSupabaseClientConfigStatus, supabase } from "@/integrations/supabase/client";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { LogoutConfirmDialog } from "@/components/LogoutConfirmDialog";
import {
  clearOAuthResponseFromUrl,
  completeOAuthSessionFromUrl,
  hasOAuthResponseInUrl,
  OAUTH_CALLBACK_PATH,
} from "@/lib/oauth-session";
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

type AuthCtx = {
  session: Session | null;
  user: SupabaseUser | null;
  isLoaded: boolean;
  openAuth: (mode: "sign-in" | "sign-up") => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function ClerkProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [dialog, setDialog] = useState<AuthDialogState>({ open: false, mode: "sign-in" });

  useEffect(() => {
    // Register listener first so we capture the SIGNED_IN that fires when
    // setSession() persists the OAuth tokens below. Missing Supabase browser
    // config must not take down the public homepage; auth becomes unavailable
    // until deployment config is repaired.
    let cancelled = false;
    const config = getSupabaseClientConfigStatus();
    if (!config.configured) {
      console.error(`[KovaAuth] Supabase auth unavailable. Missing: ${config.missing.join(", ")}`);
      setSession(null);
      setIsLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      if (!newSession && hasOAuthResponseInUrl()) return;
      setSession(newSession);
      setIsLoaded(true);
    });

    async function hydrateSession() {
      try {
        if (hasOAuthResponseInUrl() && window.location.pathname !== OAUTH_CALLBACK_PATH) {
          // Clear the OAuth params from the URL up-front so a StrictMode
          // double-invoke / reload can't re-trigger exchange.
          const oauthSession = await completeOAuthSessionFromUrl("app bootstrap");
          clearOAuthResponseFromUrl();
          if (cancelled) return;
          if (oauthSession) {
            setSession(oauthSession);
            setIsLoaded(true);
            return;
          }
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("[KovaAuth] Initial session restore failed.", error);
        }
        if (data.session) {
          const { data: userData, error: userError } = await supabase.auth.getUser();
          if (userError || !userData.user) {
            console.error(
              "[KovaAuth] Current user check failed during session restore.",
              userError,
            );
            if (!cancelled) {
              setSession(null);
              setIsLoaded(true);
            }
            return;
          }
        }
        if (cancelled) return;
        setSession(data.session);
        setIsLoaded(true);
      } catch (error) {
        console.error("[KovaAuth] Auth initialization failed.", error);
        if (!cancelled) setIsLoaded(true);
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

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
    setDialog({ open: true, mode });
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // Clear any cached private user data from the device on sign-out.
    try {
      const keep = new Set(["nova-gpt-theme"]);
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          !keep.has(k) &&
          (k.startsWith("nova-") || k.startsWith("kova") || k.startsWith("sb-"))
        ) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {}
    // Hard reload drops any in-memory React-Query / router caches too.
    if (typeof window !== "undefined") window.location.assign("/");
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoaded,
      openAuth,
      signOut,
    }),
    [session, isLoaded, openAuth, signOut],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <AuthDialog
        open={dialog.open}
        mode={dialog.mode}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
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
  const { user, isLoaded } = useAuthCtx();
  const adapted = adaptUser(user);
  return { user: adapted, isSignedIn: !!user, isLoaded };
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
    const child = children as ReactElement<{ onClick?: (e: MouseEvent<HTMLElement>) => void }>;

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
                  new CustomEvent("kova-open-settings", { detail: { tab: "general" } }),
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
