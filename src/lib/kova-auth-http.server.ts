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
  consumeHandoff,
  consumeOAuthState,
  consumeRecovery,
  consumeVerification,
  activateTotp,
  beginMfaLogin,
  beginTotpEnrollment,
  createCompatibilityPrincipal,
  createOAuthState,
  createPasswordAccount,
  createPasswordSession,
  createRecovery,
  deleteCompatibilityPrincipal,
  disableLegacyPassword,
  finishGoogle,
  finishMfaLogin,
  hasVerifiedLegacyMfa,
  lookupPassword,
  listTotpFactors,
  readMfaLoginChallenge,
  readTotpEnrollment,
  removeTotpFactor,
  recoveryTarget,
  resolveSession,
  revokeSession,
  rotateSession,
} from "@/lib/kova-auth-store.server";
import { safeRelativeRedirect } from "@/lib/auth-security.mjs";
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
const DUMMY_PASSWORD_HASH =
  "scrypt-v1$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MFA_LOGIN_CHALLENGE_SECONDS = 300;

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

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json")
    return jsonError("Content-Type must be application/json.", 415);
  try {
    const raw = await readUtf8BodyBounded(request, MAX_AUTH_BODY_BYTES);
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
  let candidateAccountId: string | null = null;
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
    candidateAccountId = await createCompatibilityPrincipal();
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
      candidateAccountId = null;
    }
    return json(
      { accepted: true, message: "If this address can be registered, check your inbox." },
      { status: 202 },
    );
  } catch (error) {
    if (candidateAccountId) await cleanupCandidate(candidateAccountId);
    console.error("[KovaAuth] Signup failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Sign up is temporarily unavailable.", 503);
  }
}

export async function handleKovaLogin(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const limited = await rateLimit(request, "kova_auth_login", 20, 900);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const challengeToken = typeof body.challengeToken === "string" ? body.challengeToken : "";
  if (challengeToken) {
    const code = typeof body.code === "string" ? body.code : "";
    if (!/^\d{6}$/u.test(code)) return jsonError("Enter a valid 6-digit code.", 400);
    const challengeLimit = await rateLimit(request, "kova_auth_mfa_login", 10, 900);
    if (challengeLimit) return challengeLimit;
    try {
      const challengeDigest = digestKovaToken(challengeToken);
      const challenge = await readMfaLoginChallenge(challengeDigest);
      const secret = decryptKovaSecret(challenge.secretEnvelope);
      if (!verifyKovaTotp(code, secret)) {
        return jsonError(
          "That code was not accepted. Check your authenticator and try again.",
          401,
        );
      }
      const sessionToken = generateKovaToken();
      const principal = await finishMfaLogin({
        challengeDigest,
        sessionDigest: digestKovaToken(sessionToken),
        sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
      });
      return sessionResponse(principal, sessionToken);
    } catch (error) {
      console.error("[KovaAuth] MFA login failed", {
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return jsonError("That verification attempt expired or could not be completed.", 401);
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
  try {
    const principal = await resolveKovaRequestPrincipal(request);
    if (!principal) return jsonError("Invalid or expired session.", 401);
    return json({ accessToken: signKovaCompatibilityJwt(principal), expiresIn: 300 });
  } catch (error) {
    console.error("[KovaAuth] Compatibility token issue failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Authentication is temporarily unavailable.", 503);
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
  const limited = await rateLimit(request, "kova_auth_mfa_enroll", 10, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const friendlyName =
    typeof body.friendlyName === "string" && body.friendlyName.trim()
      ? body.friendlyName.trim().slice(0, 120)
      : "Authenticator app";
  try {
    const principal = await resolveSession(sessionDigest);
    if (!principal) return jsonError("Invalid or expired session.", 401);
    const enrollment = generateKovaTotpEnrollment(principal.email);
    const created = await beginTotpEnrollment({
      sessionDigest,
      secretEnvelope: encryptKovaSecret(enrollment.secret),
      friendlyName,
    });
    return json({
      factorId: created.factorId,
      secret: enrollment.secret,
      uri: enrollment.uri,
    });
  } catch (error) {
    console.error("[KovaAuth] MFA enrollment failed", {
      error: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonError("Authenticator setup could not start.", 503);
  }
}

export async function handleKovaMfaVerify(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const limited = await rateLimit(request, "kova_auth_mfa_verify", 10, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const factorId = typeof body.factorId === "string" ? body.factorId : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!/^[0-9a-f-]{36}$/iu.test(factorId) || !/^\d{6}$/u.test(code)) {
    return jsonError("Invalid verification request.", 400);
  }
  try {
    const envelope = await readTotpEnrollment({ sessionDigest, factorId });
    if (!verifyKovaTotp(code, decryptKovaSecret(envelope))) {
      return jsonError("That code was not accepted.", 401);
    }
    const recoveryCodes = Array.from({ length: 8 }, () => generateKovaToken());
    await activateTotp({
      sessionDigest,
      factorId,
      recoveryDigests: recoveryCodes.map(digestKovaToken),
    });
    return json({ enabled: true, recoveryCodes });
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
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const factorId = typeof body.factorId === "string" ? body.factorId : "";
  if (!/^[0-9a-f-]{36}$/iu.test(factorId)) return jsonError("Invalid factor.", 400);
  try {
    await removeTotpFactor({ sessionDigest, factorId });
    return json({ removed: true });
  } catch {
    return jsonError("The authenticator could not be removed.", 403);
  }
}

export async function handleKovaRefresh(request: Request): Promise<Response> {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
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
    link.searchParams.set("token", recoveryToken);
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
    // Disable the hosted-auth password before consuming the one-time recovery
    // token. If the database transaction fails, the Kova token remains usable
    // for a safe retry and the legacy password cannot regain access.
    await disableLegacyPassword(accountId);
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
  const limited = await rateLimit(request, "kova_auth_google_start", 20, 3600);
  if (limited) return limited;
  try {
    const configuredAuthOrigin = authOrigin();
    if (new URL(request.url).origin !== configuredAuthOrigin) return jsonError("Not found", 404);
    const clientId = process.env.KOVA_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("Google OAuth is not configured");
    const returnTo = safeRelativeRedirect(
      new URL(request.url).searchParams.get("return_to"),
      publicOrigin(),
      "/api/auth/google",
    );
    const state = generateKovaToken();
    const nonce = generateKovaToken();
    const verifier = generateKovaToken(48);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    await createOAuthState({
      stateDigest: digestKovaToken(state),
      nonceDigest: createHash("sha256").update(nonce, "utf8").digest("hex"),
      pkceVerifierCiphertext: encryptKovaSecret(verifier),
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
    return new Response(null, {
      status: 302,
      headers: noStoreHeaders({
        Location: authorization.toString(),
        "Set-Cookie": googleStateCookie(state),
      }),
    });
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
  let candidateAccountId: string | null = null;
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
        code_verifier: decryptKovaSecret(stateRecord.pkceVerifierCiphertext),
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

    candidateAccountId = await createCompatibilityPrincipal();
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
      candidateAccountId = null;
    }
    const target = new URL("/api/auth/google/exchange", publicOrigin());
    target.searchParams.set("handoff", handoff);
    target.searchParams.set("return_to", stateRecord.returnTo);
    return new Response(null, {
      status: 303,
      headers: noStoreHeaders({
        Location: target.toString(),
        "Set-Cookie": clearGoogleStateCookie(),
      }),
    });
  } catch (error) {
    if (candidateAccountId) await cleanupCandidate(candidateAccountId);
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
    const handoff = url.searchParams.get("handoff") ?? "";
    const sessionToken = generateKovaToken();
    const principal = await consumeHandoff({
      handoffDigest: digestKovaToken(handoff),
      sessionDigest: digestKovaToken(sessionToken),
      sessionExpiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    const returnTo = safeRelativeRedirect(
      url.searchParams.get("return_to"),
      configuredPublicOrigin,
      "/api/auth/google",
    );
    return new Response(null, {
      status: 303,
      headers: noStoreHeaders({
        Location: new URL(returnTo, configuredPublicOrigin).toString(),
        "Set-Cookie": serializeKovaSessionCookie(sessionToken, {
          maxAge: KOVA_AUTH_SESSION_SECONDS,
        }),
      }),
    });
  } catch {
    return googleFailureRedirect("google_handoff_invalid");
  }
}
