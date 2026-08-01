// Per-user Google OAuth token management. Server-only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  decryptCredential,
  encryptCredential,
  requireCredentialVaultConfiguration,
} from "@/integrations/credential-vault.server";
import type { Database } from "@/integrations/supabase/types";
import {
  disconnectGoogleTokenCredential,
  loadGoogleTokenCredential,
  preserveGoogleRefreshToken,
  refreshGoogleTokenCredential,
  storeGoogleTokenCredential,
  type GoogleTokenBundle,
} from "@/lib/google-token-bundle.mjs";

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

const TOKEN_COLUMNS =
  "user_id, google_sub, email, access_token, refresh_token, token_ciphertext, refresh_claim_id, refresh_claimed_at, expires_at, scopes, created_at, updated_at";

type GoogleTokenRow = Database["public"]["Tables"]["google_oauth_tokens"]["Row"];
type StoredGoogleToken = { row: GoogleTokenRow; bundle: GoogleTokenBundle };

function admin(): SupabaseClient<Database> {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
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
    prompt: "consent",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

function parseTokenResponse(value: unknown): TokenResponse {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("google_token_response_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.access_token !== "string" ||
    candidate.access_token.length === 0 ||
    typeof candidate.expires_in !== "number" ||
    !Number.isFinite(candidate.expires_in) ||
    candidate.expires_in <= 0 ||
    (candidate.refresh_token !== undefined &&
      (typeof candidate.refresh_token !== "string" || candidate.refresh_token.length === 0)) ||
    (candidate.scope !== undefined && typeof candidate.scope !== "string") ||
    (candidate.id_token !== undefined && typeof candidate.id_token !== "string")
  ) {
    throw new Error("google_token_response_invalid");
  }
  return candidate as TokenResponse;
}

export async function exchangeCodeForTokens(
  code: string,
  request: Request,
  codeVerifier: string,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
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
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("google_temporarily_unavailable");
  }
  if (!res.ok) {
    throw new Error(`google_token_exchange_failed_${res.status}`);
  }
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new Error("google_token_response_invalid");
  }
  return parseTokenResponse(value);
}

function decodeIdToken(idToken: string | undefined): {
  sub?: string;
  email?: string;
} {
  if (!idToken) return {};
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    return {
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return {};
  }
}

async function fetchTokenRow(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<GoogleTokenRow | null> {
  const { data, error } = await db
    .from("google_oauth_tokens")
    .select(TOKEN_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("google_token_read_failed");
  return data as GoogleTokenRow | null;
}

async function readStoredGoogleTokens(
  userId: string,
  db = admin(),
): Promise<StoredGoogleToken | null> {
  const row = await fetchTokenRow(db, userId);
  return loadGoogleTokenCredential({
    userId,
    row,
    encrypt: encryptCredential,
    decrypt: decryptCredential,
    migrateLegacy: async (write) => {
      if (!row) return null;
      const { data, error } = await db
        .from("google_oauth_tokens")
        .update({ ...write, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("token_ciphertext", null)
        .is("refresh_claim_id", null)
        .is("refresh_claimed_at", null)
        .eq("expires_at", row.expires_at)
        .eq("updated_at", row.updated_at)
        .select(TOKEN_COLUMNS)
        .maybeSingle();
      if (error) throw new Error("google_token_migration_failed");
      return data as GoogleTokenRow | null;
    },
    refetch: () => fetchTokenRow(db, userId),
  });
}

export async function prepareGoogleTokenStorage(userId: string): Promise<void> {
  try {
    await requireCredentialVaultConfiguration();
  } catch {
    throw new Error("google_token_storage_not_ready");
  }
  const db = admin();
  const { data: schemaReady, error } = await db.rpc("google_oauth_token_encryption_ready");
  if (error || schemaReady !== true) throw new Error("google_token_storage_not_ready");
  await readStoredGoogleTokens(userId, db);
}

export async function storeGoogleTokens(userId: string, untrustedTokens: TokenResponse) {
  const tokens = parseTokenResponse(untrustedTokens);
  const db = admin();
  const existing = await readStoredGoogleTokens(userId, db);
  const idInfo = decodeIdToken(tokens.id_token);
  const refreshToken = preserveGoogleRefreshToken(
    tokens.refresh_token,
    existing?.bundle.refreshToken,
  );
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(tokens.expires_in - 30, 0) * 1000).toISOString();
  await storeGoogleTokenCredential({
    userId,
    accessToken: tokens.access_token,
    refreshToken,
    encrypt: encryptCredential,
    decrypt: decryptCredential,
    upsert: async (write) => {
      const { data, error } = await db
        .from("google_oauth_tokens")
        .upsert(
          {
            ...write,
            user_id: userId,
            google_sub: idInfo.sub ?? existing?.row.google_sub ?? null,
            email: idInfo.email ?? existing?.row.email ?? null,
            refresh_claim_id: null,
            refresh_claimed_at: null,
            expires_at: expiresAt,
            scopes: tokens.scope ?? existing?.row.scopes ?? "",
            updated_at: now,
          },
          { onConflict: "user_id" },
        )
        .select(TOKEN_COLUMNS)
        .maybeSingle();
      if (error || data?.user_id !== userId) throw new Error("google_token_store_failed");
      return data as GoogleTokenRow | null;
    },
  });
}

export async function getGoogleConnection(userId: string) {
  const stored = await readStoredGoogleTokens(userId);
  if (!stored) return null;
  return {
    email: stored.row.email,
    scopes: stored.row.scopes,
    expires_at: stored.row.expires_at,
    hasRefreshToken: stored.bundle.refreshToken !== null,
  };
}

export type GoogleConnectionHealth = {
  connected: boolean;
  state:
    | "connected"
    | "disconnected"
    | "reauthorization_required"
    | "permission_incomplete"
    | "temporarily_unavailable";
  email?: string | null;
  scopes: string[];
  has: {
    gmail: boolean;
    gmailWrite: boolean;
    calendar: boolean;
    calendarWrite: boolean;
    drive: boolean;
  };
};

export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI &&
      process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY,
  );
}

export async function getGoogleConnectionHealth(userId: string): Promise<GoogleConnectionHealth> {
  if (!googleOAuthConfigured()) {
    return {
      connected: false,
      state: "temporarily_unavailable",
      scopes: [],
      has: {
        gmail: false,
        gmailWrite: false,
        calendar: false,
        calendarWrite: false,
        drive: false,
      },
    };
  }
  await prepareGoogleTokenStorage(userId);
  const connection = await getGoogleConnection(userId);
  if (!connection) {
    return {
      connected: false,
      state: "disconnected",
      scopes: [],
      has: {
        gmail: false,
        gmailWrite: false,
        calendar: false,
        calendarWrite: false,
        drive: false,
      },
    };
  }
  const scopes = (connection.scopes ?? "").split(/\s+/).filter(Boolean);
  const has = {
    gmail: scopes.some((scope) =>
      [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
      ].includes(scope),
    ),
    gmailWrite: scopes.some((scope) =>
      [
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.modify",
      ].includes(scope),
    ),
    calendar: scopes.some((scope) =>
      [
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar",
      ].includes(scope),
    ),
    calendarWrite: scopes.some((scope) =>
      [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar",
      ].includes(scope),
    ),
    drive: scopes.some((scope) =>
      [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
      ].includes(scope),
    ),
  };
  const expired = new Date(connection.expires_at).getTime() <= Date.now() + 5_000;
  if (expired && !connection.hasRefreshToken) {
    return {
      connected: false,
      state: "reauthorization_required",
      email: connection.email,
      scopes,
      has,
    };
  }
  if (expired) {
    try {
      await refreshAccessToken(userId);
    } catch (error) {
      const state =
        error instanceof Error && error.message === "google_reauthorization_required"
          ? "reauthorization_required"
          : "temporarily_unavailable";
      return {
        connected: false,
        state,
        email: connection.email,
        scopes,
        has,
      };
    }
  }
  const complete = has.gmail && has.gmailWrite && has.calendar && has.calendarWrite && has.drive;
  return {
    connected: true,
    state: complete ? "connected" : "permission_incomplete",
    email: connection.email,
    scopes,
    has,
  };
}

export async function disconnectGoogle(userId: string) {
  const db = admin();
  await disconnectGoogleTokenCredential({
    load: () => readStoredGoogleTokens(userId, db),
    deleteRow: async (row) => {
      const { data, error } = await db
        .from("google_oauth_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("expires_at", row.expires_at)
        .eq("updated_at", row.updated_at)
        .select("user_id")
        .maybeSingle();
      if (error) throw new Error("google_token_purge_failed");
      return data?.user_id === userId;
    },
    revoke: async (token) => {
      // Keep the credential out of the URL and never inspect or log the response body. The
      // owner-scoped CAS delete is verified before this best-effort provider request runs.
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(30_000),
      });
    },
  });
}

async function refreshAccessToken(userId: string): Promise<string> {
  const db = admin();
  return refreshGoogleTokenCredential({
    userId,
    load: () => readStoredGoogleTokens(userId, db),
    claimRefresh: async (row, claim) => {
      let query = db
        .from("google_oauth_tokens")
        .update({
          refresh_claim_id: claim.id,
          refresh_claimed_at: claim.at,
          updated_at: claim.at,
        })
        .eq("user_id", userId)
        .eq("expires_at", row.expires_at)
        .eq("updated_at", row.updated_at);
      if (row.refresh_claim_id && row.refresh_claimed_at) {
        query = query
          .eq("refresh_claim_id", row.refresh_claim_id)
          .eq("refresh_claimed_at", row.refresh_claimed_at);
      } else {
        query = query.is("refresh_claim_id", null).is("refresh_claimed_at", null);
      }
      const { data, error } = await query.select(TOKEN_COLUMNS).maybeSingle();
      if (error) throw new Error("google_token_refresh_claim_failed");
      return data as GoogleTokenRow | null;
    },
    refetch: () => fetchTokenRow(db, userId),
    releaseRefresh: async (_row, claim) => {
      const { error } = await db
        .from("google_oauth_tokens")
        .update({
          refresh_claim_id: null,
          refresh_claimed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("refresh_claim_id", claim.id)
        .eq("refresh_claimed_at", claim.at)
        .select("user_id")
        .maybeSingle();
      if (error) throw new Error("google_token_refresh_release_failed");
    },
    providerRefresh: async (refreshToken) => {
      let res: Response;
      try {
        res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
            client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new Error("google_temporarily_unavailable");
      }
      if (!res.ok) {
        throw new Error(
          res.status === 400 || res.status === 401
            ? "google_reauthorization_required"
            : "google_temporarily_unavailable",
        );
      }
      let value: unknown;
      try {
        value = await res.json();
      } catch {
        throw new Error("google_token_response_invalid");
      }
      const tokens = parseTokenResponse(value);
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
      };
    },
    completeRefresh: async ({ claimedRow, claim, response, write }) => {
      const updatedAt = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + Math.max(response.expiresIn - 30, 0) * 1000,
      ).toISOString();
      const { data, error } = await db
        .from("google_oauth_tokens")
        .update({
          ...write,
          refresh_claim_id: null,
          refresh_claimed_at: null,
          expires_at: expiresAt,
          scopes: response.scope ?? claimedRow.scopes,
          updated_at: updatedAt,
        })
        .eq("user_id", userId)
        .eq("refresh_claim_id", claim.id)
        .eq("refresh_claimed_at", claim.at)
        .eq("updated_at", claimedRow.updated_at)
        .select(TOKEN_COLUMNS)
        .maybeSingle();
      if (error) throw new Error("google_token_refresh_store_failed");
      return data as GoogleTokenRow | null;
    },
    encrypt: encryptCredential,
    decrypt: decryptCredential,
  });
}

export async function getValidGoogleAccessToken(userId: string): Promise<string> {
  const stored = await readStoredGoogleTokens(userId);
  if (!stored) throw new Error("google_not_connected");
  if (new Date(stored.row.expires_at).getTime() > Date.now() + 5_000) {
    return stored.bundle.accessToken;
  }
  return refreshAccessToken(userId);
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
  } catch {
    console.warn("[audit] insert failed");
  }
}
