import { isCrossSiteMutation } from "./auth-security.mjs";
import { BodyReadError, readUtf8BodyBounded } from "./endpoint-reliability.mjs";
import {
  readAccountPolicy,
  scheduleAccountPolicyDeletion,
  recoverAccountPolicy,
} from "./account-lifecycle-policy.mjs";

function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

/** Scheduling/recovery never receives a cleanup callback or Stripe client. */
export function makeAccountLifecycleHandlers({ authenticate }) {
  async function handler(request, action) {
    if (action !== "status" && isCrossSiteMutation(request))
      return json({ error: "Cross-site account changes are not allowed." }, 403);
    const auth = await authenticate(request);
    if (auth instanceof Response) return auth;
    if (request.headers.get("X-Kova-Expected-User") !== auth.userId)
      return json({ error: "Your account changed. Reload and retry." }, 409);
    // Current launch authority remains Supabase. Do not silently modify the
    // separately owned, unaccepted self-hosted Auth lifecycle contract.
    if (auth.authProvider !== "supabase")
      return json(
        { error: "Account recovery is unavailable for this authentication provider." },
        503,
      );
    if (action !== "status") {
      const media = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (media !== "application/json")
        return json({ error: "Content-Type must be application/json." }, 415);
      let body;
      try {
        body = JSON.parse(await readUtf8BodyBounded(request, 1024));
      } catch (error) {
        return json(
          { error: "Invalid request body." },
          error instanceof BodyReadError ? error.status : 400,
        );
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        (action === "schedule" ? body.confirmation !== "DELETE" : body.action !== "recover")
      )
        return json(
          {
            error:
              action === "schedule"
                ? "Type DELETE to confirm scheduling."
                : "Explicit recovery is required.",
          },
          400,
        );
    }
    try {
      const state =
        action === "status"
          ? await readAccountPolicy(auth.supabaseAdmin, auth.userId)
          : action === "schedule"
            ? await scheduleAccountPolicyDeletion(auth.supabaseAdmin, auth.userId)
            : await recoverAccountPolicy(auth.supabaseAdmin, auth.userId);
      return json(
        { ...state, billingChanged: false, accountId: auth.userId },
        action === "schedule" ? 202 : 200,
      );
    } catch {
      return json(
        {
          error:
            action === "recover"
              ? "Recovery could not be verified; the deadline may have passed. Check account status."
              : "Account status could not be verified. No completion is claimed.",
          code: "account_policy_unavailable",
          state: "unknown",
        },
        action === "recover" ? 409 : 503,
      );
    }
  }
  return {
    GET: ({ request }) => handler(request, "status"),
    DELETE: ({ request }) => handler(request, "schedule"),
    PATCH: ({ request }) => handler(request, "recover"),
  };
}
