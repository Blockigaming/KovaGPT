import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { disconnectGoogle } from "@/lib/google-oauth.server";
import { disconnectAllGitHub } from "@/lib/github-oauth.server";
import { disconnectAllOAuth } from "@/integrations/oauth-lifecycle.server";
import { disconnectAllFinance } from "@/finances/plaid.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { retireStripeCustomerForAccountDeletion } from "@/lib/stripe-account-deletion.mjs";

const TERMINAL_SUBSCRIPTION_STATES = new Set(["canceled", "incomplete_expired"]);
const MAX_DELETE_BODY_BYTES = 1_024;

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/account")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        if (isCrossSiteMutation(request)) {
          return jsonError("Cross-site account changes are not allowed.", 403);
        }
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        const mediaType = request.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (mediaType !== "application/json") {
          return jsonError("Content-Type must be application/json.", 415);
        }
        let raw: string;
        try {
          raw = await readUtf8BodyBounded(request, MAX_DELETE_BODY_BYTES);
        } catch (error) {
          if (error instanceof BodyReadError) {
            return jsonError(
              error.status === 413 ? "Request too large." : "Invalid request body.",
              error.status,
            );
          }
          return jsonError("Invalid request body.", 400);
        }
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return jsonError("Invalid JSON.", 400);
        }
        const confirmation =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as { confirmation?: unknown }).confirmation
            : undefined;
        if (confirmation !== "DELETE") {
          return jsonError("Type DELETE to confirm account deletion.", 400);
        }

        // Stripe is authoritative here: webhook persistence can lag Checkout.
        // Keep the auth user and immutable Customer mapping until every mapped
        // Customer has been paginated and every nonterminal subscription has a
        // proven terminal cancellation.
        const [mappingResult, localResult] = await Promise.all([
          auth.supabaseAdmin
            .from("stripe_customer_mappings")
            .select("environment, stripe_customer_id")
            .eq("user_id", auth.userId),
          auth.supabaseAdmin
            .from("subscriptions")
            .select("status, environment")
            .eq("user_id", auth.userId),
        ]);
        if (mappingResult.error || localResult.error) {
          return jsonError("Billing status could not be verified. Please try again.", 503);
        }

        const mappedEnvironments = new Set(
          (mappingResult.data ?? []).map((mapping) => mapping.environment),
        );
        const unmappedOpenSubscription = (localResult.data ?? []).some(
          (subscription) =>
            !TERMINAL_SUBSCRIPTION_STATES.has(subscription.status) &&
            !mappedEnvironments.has(subscription.environment),
        );
        if (unmappedOpenSubscription) {
          return jsonError(
            "Billing identity could not be verified, so your account was not deleted. Contact support.",
            503,
          );
        }

        const verifiedBillingMappings: Array<{
          environment: StripeEnv;
          customerId: string;
        }> = [];
        for (const mapping of mappingResult.data ?? []) {
          const environment: StripeEnv | null =
            mapping.environment === "live"
              ? "live"
              : mapping.environment === "sandbox"
                ? "sandbox"
                : null;
          if (!environment || !/^cus_[A-Za-z0-9]+$/u.test(mapping.stripe_customer_id)) {
            return jsonError(
              "Billing identity could not be verified, so your account was not deleted. Contact support.",
              503,
            );
          }
          verifiedBillingMappings.push({
            environment,
            customerId: mapping.stripe_customer_id,
          });
        }

        try {
          await disconnectAllFinance(auth);
        } catch (error) {
          console.error("[account-delete] financial connection removal failed", {
            error: error instanceof Error ? error.name : "unknown_error",
          });
          return jsonError(
            "Financial connections could not be removed, so your account was not deleted. Please try again or contact support.",
            502,
          );
        }

        try {
          await disconnectGoogle(auth.userId);
        } catch (error) {
          console.error("[account-delete] Google token purge failed", {
            error: error instanceof Error ? error.name : "unknown_error",
          });
          return jsonError(
            "Google credentials could not be removed, so your account was not deleted. Please try again.",
            503,
          );
        }

        try {
          await disconnectAllGitHub(auth.userId);
        } catch (error) {
          console.error("[account-delete] GitHub credential purge failed", {
            error: error instanceof Error ? error.name : "unknown_error",
          });
          return jsonError(
            "GitHub credentials could not be removed, so your account was not deleted. Please try again.",
            503,
          );
        }

        try {
          await disconnectAllOAuth(auth.userId);
        } catch (error) {
          console.error("[account-delete] linked account disconnection failed", {
            error: error instanceof Error ? error.name : "unknown_error",
          });
          return jsonError(
            "Connected accounts could not be disconnected, so your account was not deleted. Please try again.",
            503,
          );
        }

        // Retire each immutable mapped Customer as the final external barrier.
        // Customer deletion catches Checkout completions racing the earlier scan,
        // immediately cancels their subscriptions, and prevents later completion.
        for (const mapping of verifiedBillingMappings) {
          try {
            await retireStripeCustomerForAccountDeletion({
              stripe: createStripeClient(mapping.environment),
              customerId: mapping.customerId,
            });
          } catch (error) {
            console.error("[account-delete] authoritative Stripe customer retirement failed", {
              environment: mapping.environment,
              error: error instanceof Error ? error.name : "unknown_error",
            });
            return jsonError(
              "Your billing account could not be retired, so your account was not deleted. Manage billing or contact support.",
              502,
            );
          }
        }

        const { error: deleteError } = await auth.supabaseAdmin.auth.admin.deleteUser(auth.userId);
        if (deleteError) {
          console.error("[account-delete] auth deletion failed", {
            code: deleteError.code,
          });
          return jsonError("Account deletion failed. Your account remains active.", 500);
        }
        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
