import type { Provider, Session } from "@supabase/supabase-js";
import { supabase } from "../supabase/client";

type OAuthProvider = "google" | "apple" | "microsoft";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

type OAuthResult =
  | { redirected: boolean; error?: undefined; data?: unknown }
  | { redirected: false; error: Error; data?: unknown };

const providerMap: Record<OAuthProvider, Provider> = {
  google: "google",
  apple: "apple",
  microsoft: "azure",
};

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export const providerAuth = {
  auth: {
<<<<<<< HEAD
    signInWithOAuth: async (
      provider: OAuthProvider,
      opts?: SignInOptions,
    ): Promise<OAuthResult> => {
=======
    signInWithOAuth: async (provider: OAuthProvider, opts?: SignInOptions): Promise<OAuthResult> => {
>>>>>>> origin/main
      const mappedProvider = providerMap[provider];
      try {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: mappedProvider,
          options: {
            redirectTo: opts?.redirect_uri,
            scopes: opts?.extraParams?.scope,
            queryParams: opts?.extraParams,
          },
        });

        if (error) return { redirected: false, error: normalizeError(error), data };
        return { redirected: Boolean(data?.url), data };
      } catch (error) {
        return { redirected: false, error: normalizeError(error) };
      }
    },

    setSession: async (session: Session) => supabase.auth.setSession(session),
  },
};
