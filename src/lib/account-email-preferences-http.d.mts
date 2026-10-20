import type { AccountEmailPreferences } from "./account-email-preferences.mjs";
type PreferenceCaller = {
  userId: string;
  emailVerified: boolean;
  revalidateSession?: () => Promise<boolean>;
};
export function makeAccountEmailPreferenceHandlers<T extends PreferenceCaller>(dependencies: {
  authenticate: (request: Request) => Promise<T | Response>;
  consumeRateLimit: (input: {
    identity: string;
    action: string;
    limit: number;
    windowSeconds: number;
  }) => Promise<{ allowed: boolean; status: string }>;
  readPreferences: (caller: T) => Promise<unknown>;
  updatePreferences: (caller: T, preferences: Partial<AccountEmailPreferences>) => Promise<unknown>;
  publicOrigin?: string;
}): {
  GET: (context: { request: Request }) => Promise<Response>;
  PATCH: (context: { request: Request }) => Promise<Response>;
};
