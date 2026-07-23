// Lightweight per-user linked-account tracker. Connections are symbolic:
// clicking "Connect" triggers the relevant OAuth flow (Google for Gmail /
// Drive / YouTube, Apple for Apple) and we remember the linked state on the
// device. Real per-user OAuth tokens for Google API access would require
// additional scope handling and token storage beyond this MVP.
import { supabase } from "@/integrations/supabase/client";

export type LinkedProvider = "google" | "google-drive" | "youtube" | "gmail" | "apple";

const PROVIDER_META: Record<
  LinkedProvider,
  { label: string; description: string; oauthProvider: "google" | "apple"; scope?: string }
> = {
  google: {
    label: "Google",
    description: "Sign in with your Google account.",
    oauthProvider: "google",
  },
  "google-drive": {
    label: "Google Drive",
    description: "Access files from your Drive in chats.",
    oauthProvider: "google",
    scope: "https://www.googleapis.com/auth/drive.readonly",
  },
  youtube: {
    label: "YouTube",
    description: "Reference your YouTube activity.",
    oauthProvider: "google",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
  },
  gmail: {
    label: "Gmail",
    description: "Read message context from Gmail.",
    oauthProvider: "google",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
  },
  apple: {
    label: "Apple",
    description: "Sign in with your Apple ID.",
    oauthProvider: "apple",
  },
};

export const ALL_LINKED_PROVIDERS: LinkedProvider[] = [
  "google",
  "google-drive",
  "youtube",
  "gmail",
  "apple",
];

export function getProviderMeta(p: LinkedProvider) {
  return PROVIDER_META[p];
}

function storageKey(userId: string) {
  return `kova-linked-accounts:${userId}`;
}

export function getLinkedAccounts(userId: string | null | undefined): LinkedProvider[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is LinkedProvider =>
      ALL_LINKED_PROVIDERS.includes(p as LinkedProvider),
    );
  } catch {
    return [];
  }
}

export function setLinkedAccounts(userId: string, providers: LinkedProvider[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(providers));
  } catch {
    // Ignore unavailable storage while syncing linked accounts.
  }
}

export async function connectProvider(
  userId: string,
  provider: LinkedProvider,
): Promise<{ redirected: boolean; error?: string }> {
  const meta = PROVIDER_META[provider];
  try {
    const { providerAuth } = await import("@/integrations/provider-auth");
    const result = await providerAuth.auth.signInWithOAuth(meta.oauthProvider, {
      redirect_uri: window.location.origin,
      extraParams: meta.scope ? { scope: meta.scope } : undefined,
    });
    if (result.error) {
      const msg = result.error instanceof Error ? result.error.message : String(result.error);
      return { redirected: false, error: msg };
    }
    // Optimistically mark as linked; if the popup was cancelled the user
    // can disconnect from the same UI.
    const current = new Set(getLinkedAccounts(userId));
    current.add(provider);
    setLinkedAccounts(userId, Array.from(current));
    return { redirected: !!result.redirected };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { redirected: false, error: msg };
  }
}

export function disconnectProvider(userId: string, provider: LinkedProvider): void {
  const remaining = getLinkedAccounts(userId).filter((p) => p !== provider);
  setLinkedAccounts(userId, remaining);
}

/**
 * Mark the active OAuth provider as linked after a successful sign-in.
 * Called from a top-level effect so OAuth redirects update the local state.
 */
export async function syncSessionProviderToLinked(): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;
    const provider = (user.app_metadata?.provider ?? "") as string;
    if (provider !== "google" && provider !== "apple") return;
    const current = new Set(getLinkedAccounts(user.id));
    current.add(provider as LinkedProvider);
    setLinkedAccounts(user.id, Array.from(current));
  } catch {
    // Ignore unavailable storage while syncing linked accounts.
  }
}
