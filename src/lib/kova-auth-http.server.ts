import { createHash, timingSafeEqual } from "node:crypto";
import {
  clearKovaSessionCookie,
  kovaAuthEnabled,
  parseCookieHeader,
  readKovaSessionToken,
  resolveKovaAuthMode,
  serializeKovaSessionCookie,
} from "@/lib/kova-auth-contract.mjs";
import {
  decryptKovaSecret,
  digestKovaToken,
  encryptKovaSecret,
  generateKovaToken,
  generateKovaTotpEnrollment,
  hashKovaPassword,
  KOVA_AUTH_CHALLENGE_SECONDS,
  KOVA_AUTH_HANDOFF_SECONDS,
  KOVA_AUTH_SESSION_SECONDS,
  normalizeKovaEmail,
  signKovaCompatibilityJwt,
  verifyGoogleIdToken,
  verifyKovaPassword,
  verifyKovaTotp,
} from "@/lib/kova-auth-crypto.server.mjs";
import type { KovaPrincipal } from "@/lib/kova-auth-crypto.server.mjs";
import {
  exchangeGoogleHandoff,
  activateLegacyMfaMigration,
  beginLegacyMfaMigration,
  consumeOAuthState,
  consumeRecovery,
  consumeVerification,
  activateTotp,
  beginMfaLogin,
  beginTotpEnrollment,
  bindMfaLoginFactor,
  changePassword,
  createCompatibilityPrincipal,
  createOAuthState,
  createPasswordAccount,
  createPasswordSession,
  createRecovery,
  deleteCompatibilityPrincipal,
  finishGoogle,
  finishMfaLogin,
  finishMfaRecoveryLogin,
  KovaAuthStoreError,
  hasVerifiedLegacyMfa,
  legacyMfaMigrationStatus,
  lookupPassword,
  listTotpFactors,
  readLegacyMfaMigration,
  readMfaLoginChallenge,
  readTotpEnrollment,
  regenerateMfaRecoveryCodes,
  removeTotpFactor,
  recoveryTarget,
  resendVerification,
  resolveLegacyHostedMfaProof,
  resolveSession,
  revokeOtherSessions,
  revokeSession,
  rotateSession,
} from "@/lib/kova-auth-store.server";
import {
  isCrossSiteMutation,
  parseBearerToken,
  safeRelativeRedirect,
} from "@/lib/auth-security.mjs";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  BodyReadError,
  readResponseBytesBounded,
  readUtf8BodyBounded,
} from "@/lib/endpoint-reliability.mjs";

const MAX_AUTH_BODY_BYTES = 8 * 1024;
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_STATE_COOKIE = "__Host-kova_oauth_state";
const GOOGLE_BROWSER_COOKIE = "__Host-kova_oauth_browser";
const GOOGLE_MFA_COOKIE = "__Host-kova_google_mfa";
const DUMMY_PASSWORD_HASH =
  "scrypt-v1$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MFA_LOGIN_CHALLENGE_SECONDS = 300;

// Server-only protocol helpers shared with the WebAuthn routes. Keep cookie,
// throttling, error and body-size behavior identical across auth methods.
export const kovaAuthHttp = {
  json,
  jsonError,
  kovaModeAvailable,
  readJsonObject,
  rateLimit,
  requireSessionDigest,
  sessionResponse,
  publicOrigin,
  futureIso,
};

function noStoreHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: noStoreHeaders(init.headers) });
}

function jsonError(error: string, status: number, retryAfter?: number): Response {
  const headers = noStoreHeaders();
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  return Response.json({ error }, { status, headers });
}

function kovaModeAvailable(): Response | null {
  try {
    if (!kovaAuthEnabled(resolveKovaAuthMode())) return jsonError("Not found", 404);
    return null;
  } catch {
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
}

function exactHttpsOrigin(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value) {
    throw new Error(`${name} must be an exact HTTPS origin`);
  }
  return parsed.origin;
}

function publicOrigin(): string {
  return exactHttpsOrigin("KOVA_AUTH_PUBLIC_ORIGIN");
}

function authOrigin(): string {
  return exactHttpsOrigin("KOVA_AUTH_ORIGIN");
}

function futureIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function googleStateCookie(state: string): string {
  return `${GOOGLE_STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
}

function clearGoogleStateCookie(): string {
  return `${GOOGLE_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function googleBrowserCookie(value: string): string {
  return `${GOOGLE_BROWSER_COOKIE}=${value}; Path=/; Max-Age=${value ? 600 : 0}; HttpOnly; Secure; SameSite=Lax`;
}

type GoogleBrowserBinding = {
  kind: "google-init" | "google-state" | "google-handoff";
  browserDigest: string;
  publicOrigin: string;
  authOrigin: string;
  issuedAt: number;
  expiresAt: number;
  verifier?: string;
  handoffDigest?: string;
  returnTo?: string;
};

function sealGoogleBinding(
  kind: GoogleBrowserBinding["kind"],
  browserDigest: string,
  extra: Pick<GoogleBrowserBinding, "verifier" | "handoffDigest" | "returnTo"> = {},
): string {
  const issuedAt = Date.now();
  return encryptKovaSecret(
    JSON.stringify({
      ...extra,
      kind,
      browserDigest,
      publicOrigin: publicOrigin(),
      authOrigin: authOrigin(),
      issuedAt,
      expiresAt: issuedAt + (kind === "google-handoff" ? KOVA_AUTH_HANDOFF_SECONDS : 600) * 1000,
    }),
  );
}

function readGoogleBinding(
  envelope: string,
  kind: GoogleBrowserBinding["kind"],
): GoogleBrowserBinding {
  if (!envelope || envelope.length > 4096) throw new Error("google_browser_binding_invalid");
  const value = JSON.parse(decryptKovaSecret(envelope)) as GoogleBrowserBinding;
  const now = Date.now();
  if (
    !value ||
    value.kind !== kind ||
    value.publicOrigin !== publicOrigin() ||
    value.authOrigin !== authOrigin() ||
    typeof value.browserDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.browserDigest) ||
    !Number.isSafeInteger(value.issuedAt) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.issuedAt > now ||
    value.expiresAt <= now ||
    value.expiresAt <= value.issuedAt ||
    value.expiresAt - value.issuedAt >
      (kind === "google-handoff" ? KOVA_AUTH_HANDOFF_SECONDS : 600) * 1000
  ) {
    throw new Error("google_browser_binding_invalid");
  }
  return value;
}

function googleMfaCookie(challenge: string): string {
  return `${GOOGLE_MFA_COOKIE}=${challenge}; Path=/; Max-Age=${MFA_LOGIN_CHALLENGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearGoogleMfaCookie(): string {
  return `${GOOGLE_MFA_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function googleMfaChallenge(request: Request): string {
  return parseCookieHeader(request.headers.get("cookie")).get(GOOGLE_MFA_COOKIE) ?? "";
}

function googleStateMatches(request: Request, state: string): boolean {
  const cookie = parseCookieHeader(request.headers.get("cookie")).get(GOOGLE_STATE_COOKIE);
  if (!cookie) return false;
  try {
    return timingSafeEqual(
      Buffer.from(digestKovaToken(cookie), "hex"),
      Buffer.from(digestKovaToken(state), "hex"),
    );
  } catch {
    return false;
  }
}

function publicPrincipal(principal: KovaPrincipal) {
  return {
    accountId: principal.accountId,
    sessionId: principal.sessionId,
    email: principal.email,
    emailVerified: principal.emailVerified,
    displayName: principal.displayName ?? null,
    assuranceLevel: principal.assuranceLevel,
    expiresAt: principal.expiresAt,
  };
}

function sessionResponse(principal: KovaPrincipal, token?: string): Response {
  const headers = noStoreHeaders();
  if (token) {
    headers.append(
      "Set-Cookie",
      serializeKovaSessionCookie(token, { maxAge: KOVA_AUTH_SESSION_SECONDS }),
    );
  }
  return Response.json({ session: publicPrincipal(principal) }, { headers });
}

async function readJsonObject(
  request: Request,
  maxBytes = MAX_AUTH_BODY_BYTES,
): Promise<Record<string, unknown> | Response> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json")
    return jsonError("Content-Type must be application/json.", 415);
  try {
    const raw = await readUtf8BodyBounded(request, maxBytes);
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return jsonError("Invalid request.", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BodyReadError) {
      return jsonError(
        error.status === 413 ? "Request too large." : "Invalid request.",
        error.status,
      );
    }
    return jsonError("Invalid request.", 400);
  }
}

async function rateLimit(
  request: Request,
  action: string,
  limit: number,
  windowSeconds: number,
  identity = resolveAnonymousClientKey(request.headers),
): Promise<Response | null> {
  try {
    const result = await consumeApplicationRateLimit({ identity, action, limit, windowSeconds });
    if (result.allowed) return null;
    return jsonError(
      result.status === "limited"
        ? "Too many attempts. Please try again later."
        : "Request protection is temporarily unavailable.",
      result.status === "limited" ? 429 : 503,
      result.retryAfter,
    );
  } catch {
    return jsonError("Request protection is temporarily unavailable.", 503, 60);
  }
}

function emailPayload(input: {
  to: string;
  label: "kova-auth-verification" | "kova-auth-recovery";
  link: string;
  tokenDigest: string;
}): Record<string, unknown> {
  if (process.env.KOVA_EMAIL_QUEUE_ENABLED !== "true") {
    throw new Error("Kova auth email delivery is not enabled");
  }
  const verification = input.label === "kova-auth-verification";
  const title = verification ? "Verify your KovaGPT email" : "Reset your KovaGPT password";
  const action = verification ? "Verify email" : "Reset password";
  const safeLink = input.link.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const messageId = generateKovaToken(32);
  return {
    message_id: messageId,
    to: input.to,
    from: "KovaGPT <noreply@kovagpt.com>",
    sender_domain: "notify.kovagpt.com",
    subject: title,
    html: `<p>${title}</p><p><a href="${safeLink}">${action}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    text: `${title}\n\n${input.link}\n\nIf you did not request this, you can ignore this email.`,
    purpose: "auth",
    label: input.label,
    idempotency_key: `${input.label}:${input.tokenDigest}`,
    queued_at: new Date().toISOString(),
  };
}

async function cleanupCandidate(candidateAccountId: string): Promise<void> {
  try {
    await deleteCompatibilityPrincipal(candidateAccountId);
  } catch (error) {
    console.error("[KovaAuth] Compatibility principal cleanup failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
  }
}

export async function resolveKovaRequestPrincipal(request: Request): Promise<KovaPrincipal | null> {
  const credential = readKovaSessionToken(request);
  if (!credential || !credential.ok) return null;
  return resolveSession(digestKovaToken(credential.token));
}

export async function handleKovaSignup(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed", 405);
  if (
    isCrossSiteMutation(request) ||
    (!request.headers.get("origin") && request.headers.get("sec-fetch-site") !== "same-origin")
  ) {
    return jsonError("Cross-origin request rejected", 403);
  }
  const limited = await rateLimit(request, "kova_auth_signup", 5, 3600);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  let email: string;
  try {
    email = normalizeKovaEmail(typeof body.email === "string" ? body.email : "");
  } catch {
    return jsonError("Enter a valid email address.", 400);
  }
  const password = typeof body.password === "string" ? body.password : "";
  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim().slice(0, 120) : "";

  const emailLimit = await rateLimit(request, "kova_auth_signup_email", 4, 3600, `email:${email}`);
  if (emailLimit) return emailLimit;

  let passwordHash: string;
  try {
    passwordHash = await hashKovaPassword(password);
  } catch {
    return jsonError("Use a password with at least 12 characters.", 400);
  }

  const verificationToken = generateKovaToken();
  const verificationDigest = digestKovaToken(verificationToken);
  try {
    const origin = publicOrigin();
    const link = new URL("/api/auth/verify", origin);
    link.searchParams.set("token", verificationToken);
    const payload = emailPayload({
      to: email,
      label: "kova-auth-verification",
      link: link.toString(),
      tokenDigest: verificationDigest,
    });
    const candidateAccountId = await createCompatibilityPrincipal();
    const created = await createPasswordAccount({
      candidateAccountId,
      email,
      displayName,
      passwordHash,
      verificationDigest,
      verificationExpiresAt: futureIso(KOVA_AUTH_CHALLENGE_SECONDS),
      emailPayload: payload,
    });
    if (!created.candidateUsed) {
      await cleanupCandidate(candidateAccountId);
    }
    return json(
      { accepted: true, message: "If this address can be registered, check your inbox." },
      { status: 202 },
    );
  } catch (error) {
    // A lost RPC response does not prove rollback. Keep a possibly adopted
    // account; cleanup requires a positively acknowledged unused candidate.
    console.error("[KovaAuth] Signup failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Sign up is temporarily unavailable.", 503);
  }
}

export async function handleKovaVerificationResend(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed", 405);
  if (
    isCrossSiteMutation(request) ||
    (!request.headers.get("origin") && request.headers.get("sec-fetch-site") !== "same-origin")
  ) {
    return jsonError("Cross-origin request rejected", 403);
  }
  const limited = await rateLimit(request, "kova_auth_verify_resend", 5, 3600);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  if (Object.keys(body).some((key) => key !== "email")) return jsonError("Invalid request.", 400);
  let email: string;
  try {
    email = normalizeKovaEmail(typeof body.email === "string" ? body.email : "");
  } catch {
    return jsonError("Enter a valid email address.", 400);
  }
  const emailLimit = await rateLimit(
    request,
    "kova_auth_verify_resend_email",
    4,
    3600,
    `email:${email}`,
  );
  if (emailLimit) return emailLimit;
  try {
    const token = generateKovaToken();
    const verificationDigest = digestKovaToken(token);
    const link = new URL("/api/auth/verify", publicOrigin());
    link.searchParams.set("token", token);
    await resendVerification({
      email,
      verificationDigest,
      verificationExpiresAt: futureIso(KOVA_AUTH_CHALLENGE_SECONDS),
      emailPayload: emailPayload({
        to: email,
        label: "kova-auth-verification",
        link: link.toString(),
        tokenDigest: verificationDigest,
      }),
    });
    return json(
      {
        accepted: true,
        message: "If verification is available for this address, check your inbox.",
      },
      { status: 202 },
    );
  } catch {
    return jsonError("Email verification is temporarily unavailable.", 503);
  }
}

export async function handleKovaLogin(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const limited = await rateLimit(request, "kova_auth_login", 20, 900);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const googleMfaRequested = body.googleMfa === true;
  const bodyChallengeToken = typeof body.challengeToken === "string" ? body.challengeToken : "";
  const cookieChallengeToken = googleMfaRequested ? googleMfaChallenge(request) : "";
  if (googleMfaRequested && !cookieChallengeToken) {
    return jsonError("That verification attempt expired or could not be completed.", 401);
  }
  const challengeToken = googleMfaRequested ? cookieChallengeToken : bodyChallengeToken;
  if (challengeToken) {
    const hasCode = body.code !== undefined;
    const hasRecoveryCode = body.recoveryCode !== undefined;
    if (hasCode === hasRecoveryCode) {
      return jsonError("Enter an authenticator code or recovery code.", 400);
    }

    if (hasCode) {
      const code = typeof body.code === "string" ? body.code : "";
      if (!/^\d{6}$/u.test(code)) return jsonError("Enter a valid 6-digit code.", 400);
      const challengeLimit = await rateLimit(request, "kova_auth_mfa_login", 10, 900);
      if (challengeLimit) return challengeLimit;
      try {
        const challengeDigest = digestKovaToken(challengeToken);
        const challenges = await readMfaLoginChallenge(challengeDigest);
        let matchedFactorId: string | null = null;
        for (const challenge of challenges) {
          try {
            const secret = decryptKovaSecret(challenge.secretEnvelope);
            if (verifyKovaTotp(code, secret) && matchedFactorId === null) {
              matchedFactorId = challenge.factorId;
            }
          } catch {
            // A damaged sibling factor cannot turn a valid authenticator into
            // an account lockout. The final database step rechecks the factor.
          }
        }
        if (!matchedFactorId) {
          return jsonError(
            "That code was not accepted. Check your authenticator and try again.",
            401,
          );
        }
        await bindMfaLoginFactor({ challengeDigest, factorId: matchedFactorId });
        const sessionToken = generateKovaToken();
        const principal = await finishMfaLogin({
          challengeDigest,
          sessionDigest: digestKovaToken(sessionToken),
          sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
        });
        const response = sessionResponse(principal, sessionToken);
        if (googleMfaRequested) response.headers.append("Set-Cookie", clearGoogleMfaCookie());
        return response;
      } catch (error) {
        console.error("[KovaAuth] MFA login failed", {
          error: error instanceof Error ? error.name : "unknown_error",
        });
        return jsonError("That verification attempt expired or could not be completed.", 401);
      }
    }

    const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode : "";
    const recoveryLimit = await rateLimit(request, "kova_auth_mfa_recovery_login", 10, 900);
    if (recoveryLimit) return recoveryLimit;
    try {
      const challengeDigest = digestKovaToken(challengeToken);
      const recoveryDigest = digestKovaToken(recoveryCode);
      await readMfaLoginChallenge(challengeDigest);
      const sessionToken = generateKovaToken();
      const principal = await finishMfaRecoveryLogin({
        challengeDigest,
        recoveryDigest,
        sessionDigest: digestKovaToken(sessionToken),
        sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
      });
      const response = sessionResponse(principal, sessionToken);
      if (googleMfaRequested) response.headers.append("Set-Cookie", clearGoogleMfaCookie());
      return response;
    } catch (error) {
      console.error("[KovaAuth] MFA recovery login failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return jsonError("That recovery code was not accepted. Check it and try again.", 401);
    }
  }

  let email: string;
  try {
    email = normalizeKovaEmail(typeof body.email === "string" ? body.email : "");
  } catch {
    return jsonError("That email and password could not be verified.", 401);
  }
  const password = typeof body.password === "string" ? body.password : "";
  const emailLimit = await rateLimit(request, "kova_auth_login_email", 10, 900, `email:${email}`);
  if (emailLimit) return emailLimit;

  try {
    const credential = await lookupPassword(email);
    const passwordValid = credential
      ? await verifyKovaPassword(password, credential.passwordHash)
      : await verifyKovaPassword(password, DUMMY_PASSWORD_HASH);
    if (!credential || !passwordValid) {
      return jsonError("That email and password could not be verified.", 401);
    }
    if (credential.mfaRequired) {
      const nextChallengeToken = generateKovaToken();
      await beginMfaLogin({
        accountId: credential.accountId,
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        challengeDigest: digestKovaToken(nextChallengeToken),
        expiresAt: futureIso(MFA_LOGIN_CHALLENGE_SECONDS),
      });
      return json(
        {
          mfaRequired: true,
          challengeToken: nextChallengeToken,
          expiresIn: MFA_LOGIN_CHALLENGE_SECONDS,
        },
        { status: 202 },
      );
    }
    const sessionToken = generateKovaToken();
    const principal = await createPasswordSession({
      accountId: credential.accountId,
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
      sessionDigest: digestKovaToken(sessionToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    principal.displayName = credential.displayName;
    return sessionResponse(principal, sessionToken);
  } catch (error) {
    console.error("[KovaAuth] Login failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
}

export async function handleKovaLogout(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (isCrossSiteMutation(request)) return jsonError("Forbidden.", 403);
  const credential = readKovaSessionToken(request);
  if (credential?.ok) {
    try {
      await revokeSession(digestKovaToken(credential.token));
    } catch (error) {
      console.error("[KovaAuth] Logout revocation failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return jsonError("Sign out could not be completed. Please retry.", 503);
    }
  }
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders({ "Set-Cookie": clearKovaSessionCookie() }),
  });
}

export async function handleKovaSession(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const credential = readKovaSessionToken(request);
  if (!credential) return json({ session: null });
  if (!credential.ok) return jsonError("Invalid or expired session.", 401);
  try {
    const principal = await resolveSession(digestKovaToken(credential.token));
    if (!principal) return jsonError("Invalid or expired session.", 401);
    return sessionResponse(principal);
  } catch {
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
}

export async function handleKovaToken(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "GET") return jsonError("Method not allowed.", 405);
  try {
    const principal = await resolveKovaRequestPrincipal(request);
    if (!principal) return jsonError("Invalid or expired session.", 401);
    const owner = request.headers.get("X-Kova-Owner");
    const session = request.headers.get("X-Kova-Session");
    if (
      (owner !== null && owner !== principal.accountId) ||
      (session !== null && session !== principal.sessionId)
    )
      return jsonError("Session changed.", 409);
    return json({
      accessToken: signKovaCompatibilityJwt(principal),
      expiresIn: 300,
      session: publicPrincipal(principal),
    });
  } catch (error) {
    console.error("[KovaAuth] Compatibility token issue failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
}

async function requireLegacyMfaMigrationCaller(
  request: Request,
): Promise<{ userId: string; email: string } | Response> {
  let mode: ReturnType<typeof resolveKovaAuthMode>;
  try {
    mode = resolveKovaAuthMode();
  } catch {
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
  if (mode !== "dual") return jsonError("Not found", 404);
  const token = parseBearerToken(request.headers.get("authorization") ?? "");
  const expectedOwner = request.headers.get("x-kova-owner");
  if (!token || !expectedOwner) {
    return jsonError("Complete your existing two-factor verification before migrating it.", 403);
  }
  try {
    const caller = await resolveLegacyHostedMfaProof(token);
    if (caller.accountId !== expectedOwner) {
      return jsonError("Your account changed. Please try again.", 409);
    }
    if (!(await hasVerifiedLegacyMfa(caller.accountId))) {
      return jsonError("No legacy two-factor migration is required.", 409);
    }
    return { userId: caller.accountId, email: caller.email };
  } catch (error) {
    if (error instanceof KovaAuthStoreError) {
      return jsonError("Complete your existing two-factor verification before migrating it.", 403);
    }
    return jsonError("Security settings are temporarily unavailable.", 503);
  }
}

function requireSessionDigest(request: Request): string | Response {
  const credential = readKovaSessionToken(request);
  if (!credential?.ok) return jsonError("Invalid or expired session.", 401);
  return digestKovaToken(credential.token);
}

export async function handleKovaMfaFactors(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  try {
    return json({ factors: await listTotpFactors(sessionDigest) });
  } catch {
    return jsonError("Security settings could not be loaded.", 401);
  }
}

export async function handleKovaMfaEnroll(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (isCrossSiteMutation(request)) return jsonError("Forbidden.", 403);
  const limited = await rateLimit(request, "kova_auth_mfa_enroll", 10, 900);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const legacyMigration = body.legacyMigration === true;
  const friendlyName =
    typeof body.friendlyName === "string" && body.friendlyName.trim()
      ? body.friendlyName.trim().slice(0, 120)
      : "Authenticator app";

  if (legacyMigration) {
    if (
      Object.keys(body).some(
        (key) => !["legacyMigration", "friendlyName", "newPassword"].includes(key),
      ) ||
      (body.friendlyName !== undefined && typeof body.friendlyName !== "string") ||
      (body.newPassword !== undefined && typeof body.newPassword !== "string")
    ) {
      return jsonError("Invalid migration request.", 400);
    }
    const caller = await requireLegacyMfaMigrationCaller(request);
    if (caller instanceof Response) return caller;
    try {
      const status = await legacyMfaMigrationStatus(caller.userId);
      if (!status.legacyMfa) return jsonError("No legacy two-factor migration is required.", 409);
      let passwordHash: string | undefined;
      if (!status.primaryReady) {
        if (typeof body.newPassword !== "string" || !body.newPassword) {
          return json(
            {
              code: "kova_password_required",
              error:
                "Choose a new KovaGPT password before moving this account's two-factor authentication.",
            },
            { status: 409 },
          );
        }
        try {
          passwordHash = await hashKovaPassword(body.newPassword);
        } catch {
          return jsonError("Choose a stronger valid password.", 400);
        }
      }
      const accountLimit = await rateLimit(
        request,
        "kova_auth_legacy_mfa_migrate_account",
        5,
        900,
        `account:${caller.userId}`,
      );
      if (accountLimit) return accountLimit;
      const enrollment = generateKovaTotpEnrollment(status.email);
      const created = await beginLegacyMfaMigration({
        accountId: caller.userId,
        secretEnvelope: encryptKovaSecret(enrollment.secret),
        friendlyName,
        passwordHash,
      });
      if (created.email !== status.email)
        throw new KovaAuthStoreError("legacy_mfa_migration_account_mismatch");
      return json({
        legacyMigration: true,
        factorId: created.factorId,
        secret: enrollment.secret,
        uri: enrollment.uri,
        expiresAt: created.expiresAt,
      });
    } catch (error) {
      console.error("[KovaAuth] Legacy MFA migration start failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return jsonError("Two-factor migration could not start.", 503);
    }
  }

  if (
    Object.keys(body).some((key) => !["friendlyName", "currentPassword"].includes(key)) ||
    (body.friendlyName !== undefined && typeof body.friendlyName !== "string") ||
    (body.currentPassword !== undefined && typeof body.currentPassword !== "string")
  )
    return jsonError("Invalid enrollment request.", 400);
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  try {
    const principal = await resolveSession(sessionDigest);
    if (!principal?.emailVerified) return jsonError("Invalid or expired session.", 401);
    const accountLimit = await rateLimit(
      request,
      "kova_auth_mfa_enroll_account",
      5,
      900,
      `account:${principal.accountId}`,
    );
    if (accountLimit) return accountLimit;
    let credential: Awaited<ReturnType<typeof lookupPassword>> = null;
    if (typeof body.currentPassword === "string") {
      credential = await lookupPassword(principal.email);
      const valid = await verifyKovaPassword(
        body.currentPassword,
        credential?.passwordHash ?? DUMMY_PASSWORD_HASH,
      );
      if (!valid || !credential || credential.accountId !== principal.accountId) {
        return jsonError("Your current credentials could not be verified.", 401);
      }
    }
    const enrollment = generateKovaTotpEnrollment(principal.email);
    const created = await beginTotpEnrollment({
      sessionDigest,
      secretEnvelope: encryptKovaSecret(enrollment.secret),
      friendlyName,
      credentialId: credential?.credentialId,
      credentialRevision: credential?.credentialRevision,
    });
    if (created.email !== principal.email)
      throw new KovaAuthStoreError("mfa_enrollment_account_mismatch");
    return json({
      factorId: created.factorId,
      secret: enrollment.secret,
      uri: enrollment.uri,
    });
  } catch (error) {
    if (error instanceof KovaAuthStoreError && error.databaseCode === "42501") {
      return json(
        {
          code: "reauthentication_required",
          error:
            "Confirm your current password, or sign in again with Google or a passkey before setting up an authenticator.",
        },
        { status: 403 },
      );
    }
    console.error("[KovaAuth] MFA enrollment failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Authenticator setup could not start.", 503);
  }
}

export async function handleKovaMfaVerify(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (isCrossSiteMutation(request)) return jsonError("Forbidden.", 403);
  const limited = await rateLimit(request, "kova_auth_mfa_verify", 10, 900);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const factorId = typeof body.factorId === "string" ? body.factorId : "";
  const code = typeof body.code === "string" ? body.code : "";
  const legacyMigration = body.legacyMigration === true;
  if (
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(factorId) ||
    !/^\d{6}$/u.test(code) ||
    Object.keys(body).length !== (legacyMigration ? 3 : 2) ||
    (legacyMigration && !Object.hasOwn(body, "legacyMigration"))
  ) {
    return jsonError("Invalid verification request.", 400);
  }

  if (legacyMigration) {
    const caller = await requireLegacyMfaMigrationCaller(request);
    if (caller instanceof Response) return caller;
    try {
      const accountLimit = await rateLimit(
        request,
        "kova_auth_legacy_mfa_verify_account",
        10,
        900,
        `account:${caller.userId}`,
      );
      if (accountLimit) return accountLimit;
      const envelope = await readLegacyMfaMigration({
        accountId: caller.userId,
        factorId,
      });
      if (!verifyKovaTotp(code, decryptKovaSecret(envelope))) {
        return jsonError("That code was not accepted.", 401);
      }
      const recoveryCodes = Array.from({ length: 8 }, () => generateKovaToken());
      const nextToken = generateKovaToken();
      const principal = await activateLegacyMfaMigration({
        accountId: caller.userId,
        factorId,
        recoveryDigests: recoveryCodes.map(digestKovaToken),
        sessionDigest: digestKovaToken(nextToken),
        sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
      });
      if (principal.accountId !== caller.userId) {
        throw new KovaAuthStoreError("legacy_mfa_activation_account_mismatch");
      }
      return json(
        {
          migrated: true,
          recoveryCodes,
          session: publicPrincipal(principal),
        },
        { headers: sessionResponse(principal, nextToken).headers },
      );
    } catch (error) {
      console.error("[KovaAuth] Legacy MFA migration verification failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return jsonError("Two-factor migration could not be completed.", 401);
    }
  }

  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  try {
    const current = await resolveSession(sessionDigest);
    if (!current?.emailVerified) return jsonError("Invalid or expired session.", 401);
    const accountLimit = await rateLimit(
      request,
      "kova_auth_mfa_verify_account",
      10,
      900,
      `account:${current.accountId}`,
    );
    if (accountLimit) return accountLimit;
    const envelope = await readTotpEnrollment({ sessionDigest, factorId });
    if (!verifyKovaTotp(code, decryptKovaSecret(envelope))) {
      return jsonError("That code was not accepted.", 401);
    }
    const recoveryCodes = Array.from({ length: 8 }, () => generateKovaToken());
    const nextToken = generateKovaToken();
    const principal = await activateTotp({
      sessionDigest,
      factorId,
      recoveryDigests: recoveryCodes.map(digestKovaToken),
      nextSessionDigest: digestKovaToken(nextToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    if (principal.accountId !== current.accountId || principal.sessionId === current.sessionId) {
      throw new KovaAuthStoreError("mfa_activation_account_mismatch");
    }
    return json(
      { enabled: true, recoveryCodes, session: publicPrincipal(principal) },
      { headers: sessionResponse(principal, nextToken).headers },
    );
  } catch (error) {
    console.error("[KovaAuth] MFA verification failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Authenticator verification could not be completed.", 401);
  }
}

export async function handleKovaMfaRemove(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (isCrossSiteMutation(request)) return jsonError("Forbidden.", 403);
  const limited = await rateLimit(request, "kova_auth_mfa_remove", 5, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const factorId = typeof body.factorId === "string" ? body.factorId : "";
  if (
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(factorId) ||
    Object.keys(body).length !== 1
  ) {
    return jsonError("Invalid factor.", 400);
  }
  try {
    const current = await resolveSession(sessionDigest);
    if (!current?.emailVerified || current.assuranceLevel !== "aal2") {
      return jsonError("Two-factor authentication is required.", 403);
    }
    const nextToken = generateKovaToken();
    const principal = await removeTotpFactor({
      sessionDigest,
      factorId,
      nextSessionDigest: digestKovaToken(nextToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    if (
      principal.accountId !== current.accountId ||
      !principal.emailVerified ||
      principal.sessionId === current.sessionId
    ) {
      throw new KovaAuthStoreError("mfa_removal_account_mismatch");
    }
    return json(
      { removed: true, session: publicPrincipal(principal) },
      { headers: sessionResponse(principal, nextToken).headers },
    );
  } catch {
    return jsonError("The authenticator could not be removed.", 403);
  }
}

export async function handleKovaPasswordStatus(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "GET") return jsonError("Method not allowed.", 405);
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  try {
    const principal = await resolveSession(sessionDigest);
    if (!principal?.emailVerified) return jsonError("Invalid or expired session.", 401);
    const credential = await lookupPassword(principal.email);
    if (credential && credential.accountId !== principal.accountId) {
      throw new KovaAuthStoreError("password_status_account_mismatch");
    }
    return json({ hasPassword: Boolean(credential) });
  } catch {
    return jsonError("Password settings could not be loaded.", 503);
  }
}

export async function handleKovaPasswordChange(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (isCrossSiteMutation(request)) return jsonError("Forbidden.", 403);
  const limited = await rateLimit(request, "kova_auth_password_change", 5, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  if (
    typeof body.currentPassword !== "string" ||
    typeof body.newPassword !== "string" ||
    Object.keys(body).length !== 2
  )
    return jsonError("Invalid request.", 400);
  try {
    const current = await resolveSession(sessionDigest);
    if (!current?.emailVerified) return jsonError("Invalid or expired session.", 401);
    const accountLimit = await rateLimit(
      request,
      "kova_auth_password_change_account",
      5,
      900,
      `account:${current.accountId}`,
    );
    if (accountLimit) return accountLimit;
    const credential = await lookupPassword(current.email);
    const validPassword = await verifyKovaPassword(
      body.currentPassword,
      credential?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (
      !credential ||
      credential.accountId !== current.accountId ||
      !validPassword ||
      (credential.mfaRequired && current.assuranceLevel !== "aal2")
    ) {
      return jsonError("Your current credentials could not be verified.", 401);
    }
    if (body.newPassword === body.currentPassword) {
      return jsonError("Choose a different password.", 400);
    }
    let passwordHash: string;
    try {
      passwordHash = await hashKovaPassword(body.newPassword);
    } catch {
      return jsonError("Use a password with at least 12 characters and at most 1,024 bytes.", 400);
    }
    const nextToken = generateKovaToken();
    const principal = await changePassword({
      sessionDigest,
      credentialId: credential.credentialId,
      credentialRevision: credential.credentialRevision,
      passwordHash,
      nextSessionDigest: digestKovaToken(nextToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    if (
      principal.accountId !== current.accountId ||
      !principal.emailVerified ||
      principal.sessionId === current.sessionId ||
      principal.assuranceLevel !== current.assuranceLevel
    ) {
      throw new KovaAuthStoreError("password_change_principal_mismatch");
    }
    return json(
      { changed: true, session: publicPrincipal(principal) },
      { headers: sessionResponse(principal, nextToken).headers },
    );
  } catch (error) {
    return jsonError(
      "Password could not be changed. Sign in again and retry.",
      error instanceof KovaAuthStoreError && error.databaseCode === "P0001" ? 401 : 503,
    );
  }
}

export async function handleKovaMfaRecoveryRegenerate(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (isCrossSiteMutation(request)) return jsonError("Forbidden.", 403);
  const limited = await rateLimit(request, "kova_auth_mfa_regenerate", 5, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  if (body.confirm !== true || Object.keys(body).length !== 1) {
    return jsonError("Confirm that you want to replace your recovery codes.", 400);
  }
  try {
    const current = await resolveSession(sessionDigest);
    if (!current || !current.emailVerified || current.assuranceLevel !== "aal2") {
      return jsonError(
        "Sign in with two-factor authentication before replacing recovery codes.",
        403,
      );
    }
    const expectedOwner = request.headers.get("x-kova-owner");
    const expectedSession = request.headers.get("x-kova-session");
    if (
      expectedOwner !== current.accountId ||
      expectedSession !== current.sessionId
    ) {
      return jsonError("Your account changed. Please try again.", 409);
    }
    const accountLimit = await rateLimit(
      request,
      "kova_auth_mfa_regenerate_account",
      3,
      900,
      `account:${current.accountId}`,
    );
    if (accountLimit) return accountLimit;
    const recoveryCodes = Array.from({ length: 8 }, () => generateKovaToken());
    const nextToken = generateKovaToken();
    const principal = await regenerateMfaRecoveryCodes({
      sessionDigest,
      recoveryDigests: recoveryCodes.map(digestKovaToken),
      nextSessionDigest: digestKovaToken(nextToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    if (principal.accountId !== current.accountId) {
      throw new KovaAuthStoreError("recovery_regeneration_account_mismatch");
    }
    return json(
      { session: publicPrincipal(principal), recoveryCodes },
      { headers: sessionResponse(principal, nextToken).headers },
    );
  } catch (error) {
    return jsonError(
      "Recovery codes could not be replaced. Please try again.",
      error instanceof KovaAuthStoreError && error.databaseCode === "P0001" ? 403 : 503,
    );
  }
}

export async function handleKovaRevokeOtherSessions(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (isCrossSiteMutation(request)) return jsonError("Forbidden.", 403);
  const limited = await rateLimit(request, "kova_auth_revoke_other_sessions", 5, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  if (Object.keys(body).length !== 0) return jsonError("Invalid request.", 400);
  try {
    return json({ revokedCount: await revokeOtherSessions(sessionDigest) });
  } catch (error) {
    return jsonError(
      "Other sessions could not be signed out. Please try again.",
      error instanceof KovaAuthStoreError && error.databaseCode === "P0001" ? 401 : 503,
    );
  }
}

export async function handleKovaRefresh(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  if (
    isCrossSiteMutation(request) ||
    (!request.headers.get("origin") && request.headers.get("sec-fetch-site") !== "same-origin")
  )
    return jsonError("Forbidden.", 403);
  const credential = readKovaSessionToken(request);
  if (!credential?.ok) return jsonError("Invalid or expired session.", 401);
  const nextToken = generateKovaToken();
  try {
    const principal = await rotateSession({
      oldDigest: digestKovaToken(credential.token),
      newDigest: digestKovaToken(nextToken),
      expiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    return sessionResponse(principal, nextToken);
  } catch {
    return jsonError("Invalid or expired session.", 401);
  }
}

export async function handleKovaVerification(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const target = new URL("/", publicOrigin());
  const rawToken = new URL(request.url).searchParams.get("token") ?? "";
  const sessionToken = generateKovaToken();
  try {
    await consumeVerification({
      verificationDigest: digestKovaToken(rawToken),
      sessionDigest: digestKovaToken(sessionToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    // A verification link is a bearer credential delivered by email, but it is
    // not proof that the browser initiating this GET knows the account
    // password. Revoke the transactional session immediately and require an
    // explicit login to prevent login-CSRF/account-confusion attacks.
    try {
      await revokeSession(digestKovaToken(sessionToken));
    } catch (error) {
      // The raw session token is never returned or persisted outside this
      // request, so a failed best-effort revocation cannot make it usable.
      // Verification has already committed and must not be misreported as an
      // invalid link merely because cleanup is temporarily unavailable.
      console.error("[KovaAuth] Verification session cleanup failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
    }
    target.searchParams.set("verified", "1");
    target.searchParams.set("sign-in", "1");
    return new Response(null, {
      status: 303,
      headers: noStoreHeaders({ Location: target.toString() }),
    });
  } catch {
    target.searchParams.set("auth_error", "invalid_verification");
    return new Response(null, {
      status: 303,
      headers: noStoreHeaders({ Location: target.toString() }),
    });
  }
}

export async function handleKovaRecoveryRequest(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const limited = await rateLimit(request, "kova_auth_recovery", 5, 3600);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  let email: string;
  try {
    email = normalizeKovaEmail(typeof body.email === "string" ? body.email : "");
  } catch {
    return json({ accepted: true }, { status: 202 });
  }
  const emailLimit = await rateLimit(
    request,
    "kova_auth_recovery_email",
    4,
    3600,
    `email:${email}`,
  );
  if (emailLimit) return emailLimit;
  try {
    const recoveryToken = generateKovaToken();
    const recoveryDigest = digestKovaToken(recoveryToken);
    const link = new URL("/reset-password", publicOrigin());
    link.hash = new URLSearchParams({ token: recoveryToken }).toString();
    await createRecovery({
      email,
      recoveryDigest,
      recoveryExpiresAt: futureIso(KOVA_AUTH_CHALLENGE_SECONDS),
      emailPayload: emailPayload({
        to: email,
        label: "kova-auth-recovery",
        link: link.toString(),
        tokenDigest: recoveryDigest,
      }),
    });
    return json({ accepted: true }, { status: 202 });
  } catch (error) {
    console.error("[KovaAuth] Recovery request failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Recovery is temporarily unavailable.", 503);
  }
}

export async function handleKovaRecoveryReset(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const limited = await rateLimit(request, "kova_auth_recovery_reset", 10, 3600);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  let recoveryDigest: string;
  let passwordHash: string;
  try {
    recoveryDigest = digestKovaToken(token);
    passwordHash = await hashKovaPassword(password);
  } catch {
    return jsonError("The reset link or password is invalid.", 400);
  }
  try {
    const accountId = await recoveryTarget(recoveryDigest);
    if (!accountId) return jsonError("The reset link is invalid or expired.", 400);
    if (await hasVerifiedLegacyMfa(accountId)) {
      return jsonError(
        "This account has two-factor authentication enabled and cannot be migrated through password recovery yet.",
        409,
      );
    }
    // The owned database transaction retires the old password and hosted
    // refresh sessions atomically with consumption of this mailbox proof.
    const sessionToken = generateKovaToken();
    const principal = await consumeRecovery({
      recoveryDigest,
      passwordHash,
      sessionDigest: digestKovaToken(sessionToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    return sessionResponse(principal, sessionToken);
  } catch (error) {
    console.error("[KovaAuth] Recovery reset failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("The reset link is invalid, expired, or temporarily unavailable.", 400);
  }
}

export async function handleKovaGoogleStart(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const requestOrigin = new URL(request.url).origin;
  if (requestOrigin !== publicOrigin() && requestOrigin !== authOrigin())
    return jsonError("Not found", 404);
  if (
    requestOrigin === publicOrigin() &&
    (request.headers.get("sec-fetch-site") !== "same-origin" ||
      (request.headers.has("origin") && request.headers.get("origin") !== requestOrigin))
  )
    return jsonError("Cross-origin request rejected", 403);
  if (
    requestOrigin === authOrigin() &&
    requestOrigin !== publicOrigin() &&
    !new URL(request.url).searchParams.has("init")
  ) {
    const target = new URL("/api/auth/google/start", publicOrigin());
    target.searchParams.set(
      "return_to",
      safeRelativeRedirect(
        new URL(request.url).searchParams.get("return_to"),
        publicOrigin(),
        "/api/auth/google",
      ),
    );
    return new Response(null, {
      status: 303,
      headers: { Location: target.toString(), "Cache-Control": "no-store" },
    });
  }
  const limited = await rateLimit(request, "kova_auth_google_start", 20, 3600);
  if (limited) return limited;
  try {
    const configuredAuthOrigin = authOrigin();
    const configuredPublicOrigin = publicOrigin();
    const url = new URL(request.url);
    if (![configuredAuthOrigin, configuredPublicOrigin].includes(url.origin))
      return jsonError("Not found", 404);
    const clientId = process.env.KOVA_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("Google OAuth is not configured");
    const headers = noStoreHeaders();
    let browserDigest: string;
    let returnTo: string;
    if (url.origin === configuredPublicOrigin) {
      // The eventual session host must set its own host-only proof. Never
      // accept a caller-supplied browser binding at this public entry point.
      if (url.searchParams.has("init")) return jsonError("Invalid Google sign in.", 400);
      const browser = generateKovaToken();
      browserDigest = digestKovaToken(browser);
      returnTo = safeRelativeRedirect(
        url.searchParams.get("return_to"),
        configuredPublicOrigin,
        "/api/auth/google",
      );
      headers.append("Set-Cookie", googleBrowserCookie(browser));
      if (configuredPublicOrigin !== configuredAuthOrigin) {
        const target = new URL("/api/auth/google/start", configuredAuthOrigin);
        target.searchParams.set(
          "init",
          sealGoogleBinding("google-init", browserDigest, { returnTo }),
        );
        headers.set("Location", target.toString());
        return new Response(null, { status: 303, headers });
      }
    } else {
      if (!url.searchParams.has("init")) {
        const target = new URL("/api/auth/google/start", configuredPublicOrigin);
        target.searchParams.set(
          "return_to",
          safeRelativeRedirect(
            url.searchParams.get("return_to"),
            configuredPublicOrigin,
            "/api/auth/google",
          ),
        );
        headers.set("Location", target.toString());
        return new Response(null, { status: 303, headers });
      }
      if (url.searchParams.getAll("init").length !== 1)
        return jsonError("Invalid Google sign in.", 400);
      const binding = readGoogleBinding(url.searchParams.get("init")!, "google-init");
      browserDigest = binding.browserDigest;
      returnTo = safeRelativeRedirect(binding.returnTo, configuredPublicOrigin, "/api/auth/google");
    }
    const state = generateKovaToken();
    const nonce = generateKovaToken();
    const verifier = generateKovaToken(48);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    await createOAuthState({
      stateDigest: digestKovaToken(state),
      nonceDigest: createHash("sha256").update(nonce, "utf8").digest("hex"),
      pkceVerifierCiphertext: sealGoogleBinding("google-state", browserDigest, { verifier }),
      returnTo,
      expiresAt: futureIso(600),
    });
    const redirectUri = `${configuredAuthOrigin}/api/auth/google/callback`;
    const authorization = new URL(GOOGLE_AUTH_ENDPOINT);
    authorization.searchParams.set("client_id", clientId);
    authorization.searchParams.set("redirect_uri", redirectUri);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("scope", "openid email profile");
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("nonce", nonce);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    authorization.searchParams.set("prompt", "select_account");
    headers.set("Location", authorization.toString());
    headers.append("Set-Cookie", googleStateCookie(state));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("[KovaAuth] Google start failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Google sign in is temporarily unavailable.", 503);
  }
}

function googleFailureRedirect(code: string): Response {
  const target = new URL("/", publicOrigin());
  target.searchParams.set("auth_error", code);
  return new Response(null, {
    status: 303,
    headers: noStoreHeaders({
      Location: target.toString(),
      "Set-Cookie": clearGoogleStateCookie(),
    }),
  });
}

export async function handleKovaGoogleCallback(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  try {
    const configuredAuthOrigin = authOrigin();
    if (new URL(request.url).origin !== configuredAuthOrigin) return jsonError("Not found", 404);
    const clientId = process.env.KOVA_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.KOVA_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");
    const url = new URL(request.url);
    const state = url.searchParams.get("state") ?? "";
    if (!googleStateMatches(request, state)) return googleFailureRedirect("google_invalid_state");
    const stateRecord = await consumeOAuthState(digestKovaToken(state));
    const binding = readGoogleBinding(stateRecord.pkceVerifierCiphertext, "google-state");
    if (
      typeof binding.verifier !== "string" ||
      !/^[A-Za-z0-9_-]{43,128}$/u.test(binding.verifier)
    ) {
      return googleFailureRedirect("google_invalid_state");
    }
    if (url.searchParams.has("error")) return googleFailureRedirect("google_denied");
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096) return googleFailureRedirect("google_invalid_callback");

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${configuredAuthOrigin}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: binding.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Google token exchange failed");
    const tokenBytes = await readResponseBytesBounded(response, 64 * 1024, { timeoutMs: 5_000 });
    const tokenPayload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(tokenBytes),
    ) as {
      id_token?: unknown;
    };
    if (typeof tokenPayload.id_token !== "string") throw new Error("Google ID token is missing");
    const identity = await verifyGoogleIdToken(tokenPayload.id_token, {
      clientId,
      expectedNonceDigest: stateRecord.nonceDigest,
    });

    const candidateAccountId = await createCompatibilityPrincipal();
    const handoff = generateKovaToken();
    const result = await finishGoogle({
      candidateAccountId,
      providerSubject: identity.subject,
      email: identity.email,
      displayName: identity.displayName,
      handoffDigest: digestKovaToken(handoff),
      handoffExpiresAt: futureIso(KOVA_AUTH_HANDOFF_SECONDS),
    });
    if (!result.candidateUsed) {
      await cleanupCandidate(candidateAccountId);
    }
    const target = new URL("/api/auth/google/exchange", publicOrigin());
    target.searchParams.set("handoff", handoff);
    target.searchParams.set(
      "binding",
      sealGoogleBinding("google-handoff", binding.browserDigest, {
        handoffDigest: digestKovaToken(handoff),
        returnTo: stateRecord.returnTo,
      }),
    );
    target.searchParams.set("return_to", stateRecord.returnTo);
    return new Response(null, {
      status: 303,
      headers: noStoreHeaders({
        Location: target.toString(),
        "Set-Cookie": clearGoogleStateCookie(),
      }),
    });
  } catch (error) {
    // Preserve a possibly committed account after an ambiguous response.
    console.error("[KovaAuth] Google callback failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return googleFailureRedirect("google_exchange_failed");
  }
}

export async function handleKovaGoogleExchange(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  try {
    const configuredPublicOrigin = publicOrigin();
    const url = new URL(request.url);
    if (url.origin !== configuredPublicOrigin) return jsonError("Not found", 404);
    if (
      url.searchParams.getAll("handoff").length !== 1 ||
      url.searchParams.getAll("binding").length !== 1
    ) {
      return googleFailureRedirect("google_handoff_invalid");
    }
    const handoff = url.searchParams.get("handoff") ?? "";
    const binding = readGoogleBinding(url.searchParams.get("binding")!, "google-handoff");
    const browser =
      parseCookieHeader(request.headers.get("cookie")).get(GOOGLE_BROWSER_COOKIE) ?? "";
    // Authenticate both proofs BEFORE consuming the handoff, issuing MFA
    // authority, or replacing a session. A transferred link has neither right.
    if (
      binding.handoffDigest !== digestKovaToken(handoff) ||
      !timingSafeEqual(
        Buffer.from(binding.browserDigest, "hex"),
        Buffer.from(digestKovaToken(browser), "hex"),
      )
    )
      return googleFailureRedirect("google_handoff_invalid");
    const sessionToken = generateKovaToken();
    const challengeToken = generateKovaToken();
    const exchanged = await exchangeGoogleHandoff({
      handoffDigest: digestKovaToken(handoff),
      sessionDigest: digestKovaToken(sessionToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
      challengeDigest: digestKovaToken(challengeToken),
      challengeExpiresAt: futureIso(MFA_LOGIN_CHALLENGE_SECONDS),
    });
    const returnTo = safeRelativeRedirect(
      binding.returnTo,
      configuredPublicOrigin,
      "/api/auth/google",
    );
    if (exchanged.mfaRequired) {
      const target = new URL("/auth", configuredPublicOrigin);
      target.searchParams.set("email", exchanged.email);
      target.searchParams.set("mode", "sign-in");
      target.searchParams.set("google_mfa", "1");
      target.searchParams.set("return_to", returnTo);
      const headers = noStoreHeaders({
        Location: target.toString(),
        "Set-Cookie": googleMfaCookie(challengeToken),
      });
      headers.append("Set-Cookie", googleBrowserCookie(""));
      return new Response(null, {
        status: 303,
        headers,
      });
    }
    const headers = noStoreHeaders({
      Location: new URL(returnTo, configuredPublicOrigin).toString(),
      "Set-Cookie": serializeKovaSessionCookie(sessionToken, {
        maxAge: KOVA_AUTH_SESSION_SECONDS,
      }),
    });
    headers.append("Set-Cookie", googleBrowserCookie(""));
    return new Response(null, { status: 303, headers });
  } catch {
    return googleFailureRedirect("google_handoff_invalid");
  }
}
