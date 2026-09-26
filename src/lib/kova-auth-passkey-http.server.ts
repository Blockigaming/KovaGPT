import { kovaAuthHttp } from "@/lib/kova-auth-http.server";
import { lookupPassword, resolveSession } from "@/lib/kova-auth-store.server";
import { parseCookieHeader } from "@/lib/kova-auth-contract.mjs";
import {
  digestKovaToken,
  generateKovaToken,
  verifyKovaPassword,
  KOVA_AUTH_SESSION_SECONDS,
} from "@/lib/kova-auth-crypto.server.mjs";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import {
  kovaPasskeyRp,
  kovaPasskeyRegistrationOptions,
  kovaPasskeyAuthenticationOptions,
  verifyKovaPasskeyRegistration,
  verifyKovaPasskeyAuthentication,
} from "@/lib/kova-auth-passkey-crypto.server.mjs";
import {
  beginPasskeyChallenge,
  claimPasskeyChallenge,
  finishPasskeyRegistration,
  finishPasskeyLogin,
  listPasskeys,
  lookupPasskey,
  renamePasskey,
  removePasskey,
} from "@/lib/kova-auth-passkey-store.server";

const {
  json,
  jsonError,
  kovaModeAvailable,
  readJsonObject,
  rateLimit,
  requireSessionDigest,
  sessionResponse,
  publicOrigin,
  futureIso,
} = kovaAuthHttp;
const BINDING_COOKIE = "__Host-kova_passkey";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VERIFY_ERROR = "Passkey verification could not be completed. Please try again.";

function cookie(value: string, clear = false) {
  return `${BINDING_COOKIE}=${value}; Path=/; Max-Age=${clear ? 0 : 300}; HttpOnly; Secure; SameSite=Strict`;
}
function clearBinding(response: Response): Response {
  response.headers.append("Set-Cookie", cookie("", true));
  return response;
}
function allowedKeys(body: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}
function friendlyName(value: unknown): string | null {
  if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) return null;
  const result = value.trim();
  return result.length >= 1 && result.length <= 120 ? result : null;
}
function mutationGuard(request: Request): { origin: string; rpID: string } | Response {
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  try {
    const rp = kovaPasskeyRp(publicOrigin());
    // Origin is a trusted deployment value, never a Host/forwarded-header RP.
    if (isCrossSiteMutation(request, rp.origin) || request.headers.get("origin") !== rp.origin)
      return jsonError("Forbidden", 403);
    return rp;
  } catch {
    return jsonError("Passkeys are temporarily unavailable.", 503);
  }
}

async function boundPasskeySession(
  request: Request,
  sessionDigest: string,
): Promise<NonNullable<Awaited<ReturnType<typeof resolveSession>>> | Response> {
  try {
    const principal = await resolveSession(sessionDigest);
    if (!principal) return jsonError("Invalid or expired session.", 401);
    if (
      request.headers.get("X-Kova-Owner") !== principal.accountId ||
      request.headers.get("X-Kova-Session") !== principal.sessionId
    ) {
      return jsonError("Session changed.", 409);
    }
    return principal;
  } catch {
    return jsonError("Authentication is temporarily unavailable.", 503);
  }
}

export async function handleKovaPasskeyList(request: Request): Promise<Response> {
  if (request.method !== "GET") return jsonError("Method not allowed.", 405);
  const unavailable = kovaModeAvailable();
  if (unavailable) return unavailable;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const bound = await boundPasskeySession(request, sessionDigest);
  if (bound instanceof Response) return bound;
  try {
    kovaPasskeyRp(publicOrigin());
    const principal = bound;
    const keys = await listPasskeys(sessionDigest);
    const requiresPassword = principal.assuranceLevel !== "aal2";
    const password = requiresPassword ? await lookupPassword(principal.email) : null;
    return json({
      passkeys: keys.map(({ id, friendlyName, createdAt, lastUsedAt }) => ({
        id,
        friendlyName,
        createdAt,
        lastUsedAt,
      })),
      requiresPassword,
      canRegister: !requiresPassword || password?.accountId === principal.accountId,
      canRemove: principal.assuranceLevel === "aal2",
    });
  } catch {
    return jsonError("Passkey settings could not be loaded.", 401);
  }
}

export async function handleKovaPasskeyRegisterOptions(request: Request): Promise<Response> {
  const rp = mutationGuard(request);
  if (rp instanceof Response) return rp;
  const limited = await rateLimit(request, "kova_auth_passkey_register", 10, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const bound = await boundPasskeySession(request, sessionDigest);
  if (bound instanceof Response) return bound;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const name = friendlyName(body.friendlyName ?? "Passkey");
  if (!allowedKeys(body, ["friendlyName", "currentPassword"]) || !name)
    return jsonError("Invalid request.", 400);
  try {
    const principal = bound;
    if (!principal.emailVerified) return jsonError("Invalid or expired session.", 401);
    const accountLimit = await rateLimit(
      request,
      "kova_auth_passkey_register_account",
      5,
      900,
      `account:${principal.accountId}`,
    );
    if (accountLimit) return accountLimit;
    let credentialId: string | undefined;
    let credentialRevision: number | undefined;
    if (principal.assuranceLevel !== "aal2") {
      const password = await lookupPassword(principal.email);
      if (
        typeof body.currentPassword !== "string" ||
        body.currentPassword.length > 1024 ||
        !password ||
        password.accountId !== principal.accountId ||
        !(await verifyKovaPassword(body.currentPassword, password.passwordHash))
      ) {
        return jsonError(
          "Confirm your current password or sign in with two-factor authentication.",
          401,
        );
      }
      credentialId = password.credentialId;
      credentialRevision = password.credentialRevision;
    }
    const keys = await listPasskeys(sessionDigest);
    const options = await kovaPasskeyRegistrationOptions({
      accountId: principal.accountId,
      email: principal.email,
      origin: rp.origin,
      credentialIds: keys.map((key) => key.credentialId),
    });
    const binding = generateKovaToken();
    await beginPasskeyChallenge({
      purpose: "registration",
      challengeDigest: digestKovaToken(options.challenge),
      bindingDigest: digestKovaToken(binding),
      rpId: rp.rpID,
      origin: rp.origin,
      sessionDigest,
      credentialId,
      credentialRevision,
      friendlyName: name,
    });
    const response = json({ options, challengeToken: options.challenge });
    response.headers.append("Set-Cookie", cookie(binding));
    return response;
  } catch {
    return jsonError("Passkey setup could not start. Please sign in again and retry.", 401);
  }
}

export async function handleKovaPasskeyLoginOptions(request: Request): Promise<Response> {
  const rp = mutationGuard(request);
  if (rp instanceof Response) return rp;
  const limited = await rateLimit(request, "kova_auth_passkey_login_start", 20, 900);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  // Discoverable login: no email, account selector, or credential inventory.
  if (Object.keys(body).length !== 0) return jsonError("Invalid request.", 400);
  try {
    const options = await kovaPasskeyAuthenticationOptions(rp.origin);
    const binding = generateKovaToken();
    await beginPasskeyChallenge({
      purpose: "authentication",
      challengeDigest: digestKovaToken(options.challenge),
      bindingDigest: digestKovaToken(binding),
      rpId: rp.rpID,
      origin: rp.origin,
    });
    const response = json({ options, challengeToken: options.challenge });
    response.headers.append("Set-Cookie", cookie(binding));
    return response;
  } catch {
    return jsonError("Passkey sign-in is temporarily unavailable.", 503);
  }
}

async function verify(
  request: Request,
  purpose: "registration" | "authentication",
): Promise<Response> {
  const rp = mutationGuard(request);
  if (rp instanceof Response) return rp;
  const limited = await rateLimit(request, `kova_auth_passkey_verify_${purpose}`, 20, 900);
  if (limited) return limited;
  const body = await readJsonObject(request, 16 * 1024);
  if (body instanceof Response) return body;
  if (
    !allowedKeys(body, ["challengeToken", "response"]) ||
    typeof body.challengeToken !== "string"
  ) {
    return clearBinding(jsonError(VERIFY_ERROR, 401));
  }
  let sessionDigest: string | undefined;
  if (purpose === "registration") {
    const result = requireSessionDigest(request);
    if (result instanceof Response) return result;
    sessionDigest = result;
    const bound = await boundPasskeySession(request, sessionDigest);
    if (bound instanceof Response) return bound;
  }
  try {
    const binding = parseCookieHeader(request.headers.get("cookie")).get(BINDING_COOKIE) ?? "";
    const challengeDigest = digestKovaToken(body.challengeToken);
    const claimDigest = digestKovaToken(generateKovaToken());
    const claimed = await claimPasskeyChallenge({
      purpose,
      challengeDigest,
      claimDigest,
      bindingDigest: digestKovaToken(binding),
      sessionDigest,
    });
    if (claimed.origin !== rp.origin || claimed.rpId !== rp.rpID)
      throw new Error("passkey_rp_changed");
    const expected = { challenge: body.challengeToken, ...rp };
    const nextToken = generateKovaToken();
    const session = {
      nextDigest: digestKovaToken(nextToken),
      expiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    };
    if (purpose === "registration") {
      const verified = await verifyKovaPasskeyRegistration(body.response, expected);
      const principal = await finishPasskeyRegistration({
        ...verified,
        ...session,
        sessionDigest: sessionDigest!,
        challengeDigest,
        claimDigest,
      });
      if (principal.accountId !== claimed.accountId) throw new Error("passkey_owner_changed");
      return clearBinding(sessionResponse(principal, nextToken));
    }
    const credentialId = (body.response as { id?: unknown } | null)?.id;
    if (
      typeof credentialId !== "string" ||
      credentialId.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/u.test(credentialId)
    ) {
      throw new Error("passkey_response_invalid");
    }
    const key = await lookupPasskey(credentialId);
    if (!key || key.rpId !== rp.rpID) throw new Error("passkey_response_invalid");
    const accountLimit = await rateLimit(
      request,
      "kova_auth_passkey_login_account",
      10,
      900,
      `account:${key.accountId}`,
    );
    if (accountLimit) return clearBinding(accountLimit);
    const verified = await verifyKovaPasskeyAuthentication(body.response, { ...expected, key });
    const principal = await finishPasskeyLogin({
      ...session,
      ...verified,
      challengeDigest,
      claimDigest,
      key,
    });
    return clearBinding(sessionResponse(principal, nextToken));
  } catch {
    // Provider exceptions may contain credential identifiers or response data.
    // Never log or serialize them. All verification failures are identical.
    return clearBinding(jsonError(VERIFY_ERROR, 401));
  }
}

export const handleKovaPasskeyRegisterVerify = (request: Request) =>
  verify(request, "registration");
export const handleKovaPasskeyLoginVerify = (request: Request) => verify(request, "authentication");

export async function handleKovaPasskeyRename(request: Request): Promise<Response> {
  const rp = mutationGuard(request);
  if (rp instanceof Response) return rp;
  const limited = await rateLimit(request, "kova_auth_passkey_rename", 10, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const bound = await boundPasskeySession(request, sessionDigest);
  if (bound instanceof Response) return bound;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const name = friendlyName(body.friendlyName);
  if (
    !allowedKeys(body, ["passkeyId", "friendlyName"]) ||
    typeof body.passkeyId !== "string" ||
    !UUID.test(body.passkeyId) ||
    !name
  ) {
    return jsonError("Invalid request.", 400);
  }
  try {
    await renamePasskey(sessionDigest, body.passkeyId, name);
    return json({ renamed: true });
  } catch {
    return jsonError("The passkey could not be renamed.", 403);
  }
}

export async function handleKovaPasskeyRemove(request: Request): Promise<Response> {
  const rp = mutationGuard(request);
  if (rp instanceof Response) return rp;
  const limited = await rateLimit(request, "kova_auth_passkey_remove", 5, 900);
  if (limited) return limited;
  const sessionDigest = requireSessionDigest(request);
  if (sessionDigest instanceof Response) return sessionDigest;
  const bound = await boundPasskeySession(request, sessionDigest);
  if (bound instanceof Response) return bound;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  if (
    !allowedKeys(body, ["passkeyId", "confirm"]) ||
    body.confirm !== true ||
    typeof body.passkeyId !== "string" ||
    !UUID.test(body.passkeyId)
  )
    return jsonError("Invalid request.", 400);
  try {
    const nextToken = generateKovaToken();
    const principal = await removePasskey({
      sessionDigest,
      id: body.passkeyId,
      nextDigest: digestKovaToken(nextToken),
      expiresAt: futureIso(KOVA_AUTH_SESSION_SECONDS),
    });
    return sessionResponse(principal, nextToken);
  } catch {
    return jsonError(
      "The passkey could not be removed. Keep another sign-in method and sign in again.",
      403,
    );
  }
}
