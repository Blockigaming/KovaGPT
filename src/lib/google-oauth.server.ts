import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
// Per-user Google OAuth token management. Server-only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import { createGoogleAccountRuntime } from "@/lib/google-account-runtime.server.mjs";
import {
  googleConnectionHealth,
  parseGoogleBinding,
  type GoogleAccountBinding,
  type GoogleAccountHealth,
} from "@/lib/google-account-policy.mjs";
export type { GoogleAccountBinding } from "@/lib/google-account-policy.mjs";
export type { GoogleConnection } from "@/lib/google-account-runtime.server.mjs";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

/**
 * Envelope encryption for Google tokens at rest (AES-GCM, same key material as
 * the GitHub/Plaid connector vault). Ciphertext is tagged with a "gcm1." prefix
 * so rows written before this change (plain text) still decrypt transparently.
 */
const TOKEN_PREFIX = "gcm1.";
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

async function tokenKey() {
  const secret = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!secret) throw new Error("CONNECTOR_ENCRYPTION_KEY is required");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptGoogleToken(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await tokenKey(),
    new TextEncoder().encode(value),
  );
  return `${TOKEN_PREFIX}${b64u(iv)}.${b64u(new Uint8Array(sealed))}`;
}

export async function decryptGoogleToken(value: string): Promise<string> {
  if (!value.startsWith(TOKEN_PREFIX)) return value; // legacy plaintext row
  const [iv, body] = value.slice(TOKEN_PREFIX.length).split(".");
  if (!iv || !body) throw new Error("invalid_google_token_ciphertext");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64url") },
    await tokenKey(),
    Buffer.from(body, "base64url"),
  );
  return new TextDecoder().decode(clear);
}

function admin(): SupabaseClient<Database> {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export function googleRedirectUri(_request: Request): string {
  const configured = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!configured) throw new Error("GOOGLE_REDIRECT_URI is not configured");
  const redirect = new URL(configured);
  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost") {
    throw new Error("GOOGLE_REDIRECT_URI must use HTTPS outside localhost");
  }
  if (redirect.username || redirect.password || redirect.search || redirect.hash) {
    throw new Error("GOOGLE_REDIRECT_URI must not contain credentials, a query, or a fragment");
  }
  if (redirect.pathname !== "/api/google/callback") {
    throw new Error("GOOGLE_REDIRECT_URI must end with /api/google/callback");
  }
  return redirect.toString();
}

export function buildGoogleAuthUrl(opts: {
  request: Request;
  state: string;
  codeChallenge: string;
  scope?: string;
  loginHint?: string;
}): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(opts.request),
    response_type: "code",
    scope: opts.scope ?? GOOGLE_SCOPES,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(
  code: string,
  request: Request,
  codeVerifier: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(request),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`google_token_exchange_failed_${res.status}`);
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readResponseBytesBounded(res, 64 * 1024),
    ),
  ) as GoogleTokenResponse;
}

/** Revoke an exchanged grant that could not be durably attached to an account. */
export async function revokeUnstoredGoogleTokens(tokens: GoogleTokenResponse): Promise<void> {
  const token = tokens.refresh_token || tokens.access_token;
  if (!token) return;
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
  } catch {
    // Completion remains failed; never persist credentials merely because the
    // provider's best-effort revocation endpoint is temporarily unavailable.
  }
}

export async function googleVault(
  userId: string,
  operation: string,
  data: Record<string, unknown> = {},
) {
  if (!["disconnect", "disconnect_all"].includes(operation)) {
    await assertLockdownAllows(
      admin(),
      userId,
      ["begin_oauth", "complete_oauth", "select"].includes(operation)
        ? "connector_write"
        : "connector_read",
    );
  }
  const result = await (
    admin() as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => {
        abortSignal: (
          signal: AbortSignal,
        ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    }
  )
    .rpc("google_connection_rpc", { p_user_id: userId, p_operation: operation, p_data: data })
    .abortSignal(AbortSignal.timeout(10000));
  if (result.error) {
    const allowed = [
      "google_connection_changed",
      "google_reauthorization_required",
      "google_refresh_conflict",
      "google_selection_conflict",
    ];
    throw new Error(
      allowed.find((code) => result.error?.message?.includes(code)) ??
        "google_connection_unavailable",
    );
  }
  return result.data;
}
function accountRuntime() {
  return createGoogleAccountRuntime({
    vault: googleVault,
    encrypt: encryptGoogleToken,
    decrypt: decryptGoogleToken,
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
  });
}
export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI &&
    process.env.CONNECTOR_ENCRYPTION_KEY,
  );
}
export async function beginGoogleOAuth(userId: string, attemptId: string, connectionId?: string) {
  parseGoogleBinding({ connectionId });
  return (await googleVault(userId, "begin_oauth", { attemptId, connectionId })) as {
    loginHint?: string | null;
  };
}
export async function storeGoogleTokens(
  userId: string,
  tokens: GoogleTokenResponse,
  attemptId: string,
) {
  return accountRuntime().store(userId, tokens, attemptId);
}
export async function getGoogleConnection(userId: string, connectionId?: string) {
  return accountRuntime().connection(userId, { connectionId });
}
export async function getValidGoogleAccessToken(
  userId: string,
  binding: GoogleAccountBinding = {},
) {
  return accountRuntime().accessToken(userId, binding);
}
export async function disconnectGoogle(
  userId: string,
  connectionId: string,
  expectedRevision: number,
) {
  if (!connectionId) throw new Error("google_invalid_account_selection");
  return accountRuntime().disconnect(userId, connectionId, expectedRevision);
}
export async function disconnectAllGoogle(userId: string) {
  return accountRuntime().disconnect(userId, null);
}
export async function selectGoogleAccount(
  userId: string,
  connectionId: string,
  expectedRevision: number,
) {
  parseGoogleBinding({ connectionId });
  if (!connectionId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error("google_invalid_account_selection");
  return googleVault(userId, "select", { connectionId, expectedRevision });
}
export type GoogleConnectionHealth = GoogleAccountHealth;
type AccountMetadata = {
  id: string;
  credential_revision: number;
  email: string | null;
  google_sub: string | null;
  scopes: string;
  expires_at: string;
  reauthorization_required: boolean;
  has_refresh_token: boolean;
  grant_id: string;
};
export async function getGoogleAccountsHealth(userId: string) {
  if (!googleOAuthConfigured())
    return {
      ...googleConnectionHealth(null),
      state: "temporarily_unavailable" as const,
      accounts: [],
      selectedConnectionId: null,
      selectionRevision: 0,
    };
  const result = (await googleVault(userId, "list")) as {
    accounts: AccountMetadata[];
    selectedConnectionId: string | null;
    selectionRevision: number;
  };
  const selected = result.accounts.find((row) => row.id === result.selectedConnectionId) ?? null;
  return {
    ...googleConnectionHealth(selected),
    accounts: result.accounts.map((row) => googleConnectionHealth(row)),
    selectedConnectionId: result.selectedConnectionId,
    selectionRevision: result.selectionRevision,
  };
}
export async function getGoogleConnectionHealth(
  userId: string,
  connectionId?: string,
): Promise<GoogleConnectionHealth> {
  if (!connectionId) return getGoogleAccountsHealth(userId);
  const connection = await getGoogleConnection(userId, connectionId);
  return googleConnectionHealth({
    ...connection,
    has_refresh_token: Boolean(connection.refresh_token),
  });
}
export async function getGoogleExecutionBinding(
  userId: string,
  connectionId?: string,
): Promise<GoogleAccountBinding> {
  const connection = await getGoogleConnection(userId, connectionId);
  if (!connection.google_sub || connection.reauthorization_required)
    throw new Error("google_reauthorization_required");
  return {
    connectionId: connection.id,
    grantId: connection.grant_id,
    expectedGoogleSub: connection.google_sub,
  };
}

export async function logAudit(opts: {
  userId: string;
  provider: string;
  action: string;
  status?: "success" | "failure";
  resourceId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await admin()
      .from("connected_account_audit_log")
      .insert({
        user_id: opts.userId,
        provider: opts.provider,
        action: opts.action,
        status: opts.status ?? "success",
        resource_id: opts.resourceId ?? null,
        summary: opts.summary ?? null,
        metadata: (opts.metadata ?? null) as never,
      });
  } catch (e) {
    console.warn("[audit] insert failed", e);
  }
}
