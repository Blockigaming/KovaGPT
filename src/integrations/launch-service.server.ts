import { createClient } from "@supabase/supabase-js";
import { decryptCredential, encryptCredential } from "./credential-vault.server";
import { createLaunchRuntime } from "./launch-runtime.server.mjs";
import { CERTIFIED_LAUNCH_CONNECTORS, ConnectorError } from "./launch-contracts.mjs";
import { createLaunchToolContext } from "./launch-tools.server.mjs";
import type { AuthedCaller } from "@/lib/api-auth.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { resolveKovaAuthMode, selectAuthCredential } from "@/lib/kova-auth-contract.mjs";
import { digestKovaToken } from "@/lib/kova-auth-crypto.server.mjs";
import { resolveSession } from "@/lib/kova-auth-store.server";
export function launchConnectorService(request?: Request) {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return createLaunchRuntime({
    db,
    encrypt: encryptCredential,
    decrypt: decryptCredential,
    transport: { signal: request?.signal },
    assertAllowed: (ownerId, capability) => assertLockdownAllows(db, ownerId, capability),
    assertSession: async (ownerId, sessionId) => {
      // Resolve the live cookie; the encrypted transaction binds owner AND session.
      if (!request || !sessionId) throw new ConnectorError("oauth_session_required", 401);
      const credential = selectAuthCredential(request, resolveKovaAuthMode());
      if (credential.kind !== "credential" || credential.provider !== "kova")
        throw new ConnectorError("owned_session_required", 401);
      const principal = await resolveSession(digestKovaToken(credential.token));
      if (
        !principal ||
        !principal.emailVerified ||
        principal.accountId !== ownerId ||
        principal.sessionId !== sessionId
      )
        throw new ConnectorError("oauth_session_changed", 401);
    },
  });
}
export async function getLaunchToolContext(auth: AuthedCaller, request: Request) {
  const sessionId = auth.claims?.session_id;
  // No account query or model tools before a reviewed certification exists.
  if (
    CERTIFIED_LAUNCH_CONNECTORS.length === 0 ||
    auth.authProvider !== "kova" ||
    typeof sessionId !== "string"
  )
    return null;
  const db = auth.supabaseAdmin as unknown as ReturnType<typeof createClient>;
  const { data, error } = await db
    .from("integration_linked_accounts")
    .select("id,owner_id,provider_id,status,granted_scopes,deleted_at,account_label")
    .eq("owner_id", auth.userId)
    .eq("status", "connected")
    .is("deleted_at", null)
    .in("provider_id", [...CERTIFIED_LAUNCH_CONNECTORS]);
  if (error) throw new ConnectorError("connector_store_unavailable", 503);
  return createLaunchToolContext({
    ownerId: auth.userId,
    sessionId,
    accounts: data ?? [],
    runtime: launchConnectorService(request),
  });
}
