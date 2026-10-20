import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser, type HttpAuthedCaller } from "@/lib/api-auth.server";
import { makeAccountEmailPreferenceHandlers } from "@/lib/account-email-preferences-http.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

async function preferencesRpc(caller: HttpAuthedCaller, name: string, preferences?: unknown) {
  const query = caller.supabaseAdmin
    .rpc(
      name as never,
      {
        p_account_id: caller.userId,
        ...(preferences ? { p_preferences: preferences } : {}),
      } as never,
    )
    .abortSignal(AbortSignal.timeout(8000));
  const { data, error } = await query;
  if (error) throw new Error("account_email_preferences_unavailable");
  return data;
}

export const Route = createFileRoute("/api/account/email-preferences")({
  server: {
    handlers: makeAccountEmailPreferenceHandlers({
      authenticate: requireVerifiedUser,
      consumeRateLimit: consumeApplicationRateLimit,
      readPreferences: (caller) => preferencesRpc(caller, "account_email_get_preferences"),
      updatePreferences: (caller, preferences) =>
        preferencesRpc(caller, "account_email_update_preferences", preferences),
      publicOrigin: process.env.KOVA_AUTH_PUBLIC_ORIGIN,
    }),
  },
});
