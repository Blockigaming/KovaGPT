// Supabase-based auth shim. Keeps the original export surface so existing
// imports (SignedIn, SignedOut, SignInButton, SignUpButton, UserButton,
// useUser, clerkEnabled, ClerkProvider) continue to work.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export const clerkEnabled = true; // auth is always available via Lovable Cloud

type Status = "loading" | "signed-in" | "signed-out";

function useAuthState(): { status: Status; user: User | null } {
  const [state, setState] = useState<{ status: Status; user: User | null }>({
    status: "loading",
    user: null,
  });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setState({
        status: data.session?.user ? "signed-in" : "signed-out",
        user: data.session?.user ?? null,
      });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        status: session?.user ? "signed-in" : "signed-out",
        user: session?.user ?? null,
      });
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedIn({ children }: { children: ReactNode }) {
  const { status } = useAuthState();
  if (status !== "signed-in") return null;
  return <>{children}</>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { status } = useAuthState();
  if (status === "signed-in") return null;
  return <>{children}</>;
}

export function SignInButton({ children }: { children: ReactNode; mode?: "modal" | "redirect" }) {
  return (
    <Link to="/auth" style={{ display: "contents" }}>
      {children}
    </Link>
  );
}

export function SignUpButton({ children }: { children: ReactNode; mode?: "modal" | "redirect" }) {
  return (
    <Link to="/auth" search={{ mode: "signup" }} style={{ display: "contents" }}>
      {children}
    </Link>
  );
}

export function UserButton() {
  const { user } = useAuthState();
  if (!user) return null;
  const initial = (user.email ?? "?").slice(0, 1).toUpperCase();
  const signOut = async () => {
    await supabase.auth.signOut();
  };
  return (
    <button
      onClick={signOut}
      title="Sign out"
      className="w-8 h-8 rounded-full bg-foreground text-background text-xs font-semibold grid place-items-center hover:opacity-80 transition relative group"
    >
      <span className="group-hover:opacity-0 transition">{initial}</span>
      <LogOut className="w-3.5 h-3.5 absolute opacity-0 group-hover:opacity-100 transition" />
    </button>
  );
}

type ShimUser = {
  firstName?: string;
  username?: string;
  emailAddresses?: { emailAddress: string }[];
  id?: string;
  email?: string;
};

export function useUser(): { isSignedIn: boolean; user: ShimUser | null; isLoaded: boolean } {
  const { status, user } = useAuthState();
  if (!user) {
    return { isSignedIn: false, user: null, isLoaded: status !== "loading" };
  }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const firstName =
    typeof meta.full_name === "string"
      ? (meta.full_name as string).split(" ")[0]
      : typeof meta.name === "string"
        ? (meta.name as string).split(" ")[0]
        : undefined;
  return {
    isSignedIn: true,
    isLoaded: true,
    user: {
      id: user.id,
      email: user.email ?? undefined,
      firstName,
      username: typeof meta.user_name === "string" ? (meta.user_name as string) : undefined,
      emailAddresses: user.email ? [{ emailAddress: user.email }] : [],
    },
  };
}
