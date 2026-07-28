// Per-user Google OAuth token management. Server-only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

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
    const txt = await res.text().catch(() => "");
    throw new Error(`google token exchange failed: ${res.status} ${txt}`);
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
  const refresh = tokens.refresh_token ?? existing?.refresh_token ?? null;
  const row = {
    user_id: userId,
    google_sub: idInfo.sub ?? null,
    email: idInfo.email ?? null,
    access_token: tokens.access_token,
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
    .select("email, scopes, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function disconnectGoogle(userId: string) {
  const db = admin();
  const { data } = await db
    .from("google_oauth_tokens")
    .select("access_token, refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  const token = data?.refresh_token ?? data?.access_token;
  if (token) {
    // Best-effort revoke; ignore failures.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
    }).catch(() => {});
  }
  await db.from("google_oauth_tokens").delete().eq("user_id", userId);
}

async function refreshAccessToken(userId: string): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from("google_oauth_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.refresh_token) {
    throw new Error("google_not_connected");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`google refresh failed: ${res.status} ${txt}`);
  }
  const t = (await res.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString();
  await db
    .from("google_oauth_tokens")
    .update({ access_token: t.access_token, expires_at: expiresAt })
    .eq("user_id", userId);
  return t.access_token;
}

export async function getValidGoogleAccessToken(userId: string): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from("google_oauth_tokens")
    .select("access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("google_not_connected");
  if (new Date(data.expires_at).getTime() > Date.now() + 5000) return data.access_token;
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
  } catch (e) {
    console.warn("[audit] insert failed", e);
  }
}
