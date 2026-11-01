import { isCrossSiteMutation } from "./auth-security.mjs";
import { BodyReadError, readUtf8BodyBounded } from "./endpoint-reliability.mjs";
import {
  parseAccountEmailPreferencePatch,
  parseAccountEmailPreferences,
} from "./account-email-preferences.mjs";

const response = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" },
  });
const unavailable = () =>
  response({ error: "Email preferences are temporarily unavailable." }, 503);

/** Owner authority is supplied by the existing verified session adapter. */
export function makeAccountEmailPreferenceHandlers({
  authenticate,
  consumeRateLimit,
  readPreferences,
  updatePreferences,
  publicOrigin,
}) {
  async function handle(request) {
    const mutation = request.method === "PATCH";
    if (request.method !== "GET" && !mutation)
      return response({ error: "Method not allowed." }, 405);
    const expectedOrigin = publicOrigin || new URL(request.url).origin;
    if (
      mutation &&
      (isCrossSiteMutation(request, expectedOrigin) ||
        (!request.headers.get("origin") && request.headers.get("sec-fetch-site") !== "same-origin"))
    ) {
      return response({ error: "Cross-origin request rejected." }, 403);
    }
    let auth;
    try {
      auth = await authenticate(request);
    } catch {
      return unavailable();
    }
    if (auth instanceof Response) return auth;
    if (!auth?.emailVerified || typeof auth.userId !== "string")
      return response({ error: "Verified sign-in required." }, 403);
    if (request.headers.get("x-kova-owner") !== auth.userId)
      return response({ error: "Your account changed. Reload and retry." }, 409);
    try {
      const admission = await consumeRateLimit({
        identity: `account:${auth.userId}`,
        action: mutation ? "account_email_preferences_update" : "account_email_preferences_read",
        limit: mutation ? 30 : 100,
        windowSeconds: 900,
      });
      if (!admission.allowed)
        return response(
          {
            error:
              admission.status === "limited"
                ? "Too many requests. Try again later."
                : "Email preferences are temporarily unavailable.",
          },
          admission.status === "limited" ? 429 : 503,
        );
    } catch {
      return unavailable();
    }
    let patch;
    if (mutation) {
      if (
        request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
        "application/json"
      )
        return response({ error: "Content-Type must be application/json." }, 415);
      try {
        const body = JSON.parse(await readUtf8BodyBounded(request, 2048));
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 1 ||
          !Object.hasOwn(body, "preferences")
        )
          return response({ error: "Invalid preferences." }, 400);
        patch = parseAccountEmailPreferencePatch(body.preferences);
        if (!patch) return response({ error: "Invalid preferences." }, 400);
      } catch (error) {
        return response(
          { error: "Invalid preferences." },
          error instanceof BodyReadError ? error.status : 400,
        );
      }
    }
    try {
      if (auth.revalidateSession && !(await auth.revalidateSession()))
        return response({ error: "Invalid or expired session." }, 401);
      const result = mutation ? await updatePreferences(auth, patch) : await readPreferences(auth);
      const preferences = parseAccountEmailPreferences(result);
      if (!preferences) return unavailable();
      if (auth.revalidateSession && !(await auth.revalidateSession()))
        return response({ error: "Invalid or expired session." }, 401);
      return response({ version: 1, preferences });
    } catch {
      return unavailable();
    }
  }
  return { GET: ({ request }) => handle(request), PATCH: ({ request }) => handle(request) };
}
