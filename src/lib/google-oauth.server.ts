// Per-user Google OAuth token management. Server-only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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

export async function exchangeCodeForTokens(
  code: string,
  request: Request,
  codeVerifier: string,
): Promise<TokenResponse> {
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
  });
  if (!res.ok) {
    throw new Error(`google_token_exchange_failed_${res.status}`);
  }
  return res.json();
}

function decodeIdToken(idToken: string | undefined): { sub?: string; email?: string } {
  if (!idToken) return {};
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    return { sub: payload.sub, email: payload.email };
  } catch {
    return {};
  }
}

export async function storeGoogleTokens(userId: string, tokens: TokenResponse) {
  const idInfo = decodeIdToken(tokens.id_token);
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString();
  const db = admin();
  // Preserve existing refresh_token if Google didn't return a new one.
  const { data: existing } = await db
    .from("google_oauth_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  // New refresh tokens are sealed; a preserved value is already stored sealed.
  const refresh = tokens.refresh_token
    ? await encryptGoogleToken(tokens.refresh_token)
    : (existing?.refresh_token ?? null);
  const row = {
    user_id: userId,
    google_sub: idInfo.sub ?? null,
    email: idInfo.email ?? null,
    access_token: await encryptGoogleToken(tokens.access_token),
    refresh_token: refresh,
    expires_at: expiresAt,
    scopes: tokens.scope ?? "",
  };

  const { error } = await db.from("google_oauth_tokens").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(`store google tokens failed: ${error.message}`);
}

export async function getGoogleConnection(userId: string) {
  const db = admin();
  const { data } = await db
    .from("google_oauth_tokens")
    .select("email, google_sub, scopes, expires_at, refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
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
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export async function getGoogleConnectionHealth(userId: string): Promise<GoogleConnectionHealth> {
  if (!googleOAuthConfigured()) {
    return {
      connected: false,
      state: "temporarily_unavailable",
      scopes: [],
      has: { gmail: false, gmailWrite: false, calendar: false, calendarWrite: false, drive: false },
    };
  }
  const connection = await getGoogleConnection(userId);
  if (!connection) {
    return {
      connected: false,
      state: "disconnected",
      scopes: [],
      has: { gmail: false, gmailWrite: false, calendar: false, calendarWrite: false, drive: false },
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
  if (expired && !connection.refresh_token) {
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
    } catch {
      return {
        connected: false,
        state: "reauthorization_required",
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
  const { data } = await db
    .from("google_oauth_tokens")
    .select("access_token, refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  const stored = data?.refresh_token ?? data?.access_token;
  const token = stored ? await decryptGoogleToken(stored).catch(() => null) : null;
  if (token) {
    // Best-effort revoke; ignore failures.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
    }).catch(() => {});
  }
  const { error } = await db.from("google_oauth_tokens").delete().eq("user_id", userId);
  if (error) throw new Error("google_token_purge_failed");
}

async function refreshAccessToken(userId: string, expectedGoogleSub?: string): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from("google_oauth_tokens")
    .select("refresh_token, google_sub")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.refresh_token) {
    throw new Error("google_not_connected");
  }
  if (expectedGoogleSub && data.google_sub !== expectedGoogleSub) {
    throw new Error("google_connection_changed");
  }
  const refreshToken = await decryptGoogleToken(data.refresh_token);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 400 || res.status === 401
        ? "google_reauthorization_required"
        : "google_temporarily_unavailable",
    );
  }
  const t = (await res.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString();
  let refreshUpdate = db
    .from("google_oauth_tokens")
    .update({
      access_token: await encryptGoogleToken(t.access_token),
      expires_at: expiresAt,
    })
    .eq("user_id", userId);
  if (expectedGoogleSub) {
    refreshUpdate = refreshUpdate.eq("google_sub", expectedGoogleSub);
  }
  const { error: updateError } = await refreshUpdate;
  if (updateError) throw new Error("google_token_refresh_persist_failed");
  return t.access_token;
}

export async function getValidGoogleAccessToken(
  userId: string,
  expectedGoogleSub?: string,
): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from("google_oauth_tokens")
    .select("access_token, expires_at, google_sub")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("google_not_connected");
  if (expectedGoogleSub && data.google_sub !== expectedGoogleSub) {
    throw new Error("google_connection_changed");
  }
  if (new Date(data.expires_at).getTime() > Date.now() + 5000)
    return decryptGoogleToken(data.access_token);
  return refreshAccessToken(userId, expectedGoogleSub);
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
