import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { disconnectGoogle } from "@/lib/google-oauth.server";
import { disconnectAllGitHub } from "@/lib/github-oauth.server";
import { disconnectAllOAuth } from "@/integrations/oauth-lifecycle.server";
import { disconnectAllFinance } from "@/finances/plaid.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";

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

        // Stop paid service before deleting the auth user. If billing cannot be
        // verified or canceled, keep the account intact so no one can be billed
        // after losing access to the billing portal.
        const { data: subscriptions, error: subscriptionError } = await auth.supabaseAdmin
          .from("subscriptions")
          .select("stripe_subscription_id, status, environment")
          .eq("user_id", auth.userId);
        if (subscriptionError) {
          return jsonError("Billing status could not be verified. Please try again.", 503);
        }
        for (const subscription of subscriptions ?? []) {
          if (TERMINAL_SUBSCRIPTION_STATES.has(subscription.status)) continue;
          if (!subscription.stripe_subscription_id) continue;
          const environment: StripeEnv = subscription.environment === "live" ? "live" : "sandbox";
          try {
            await createStripeClient(environment).subscriptions.cancel(
              subscription.stripe_subscription_id,
            );
          } catch (error) {
            console.error("[account-delete] subscription cancellation failed", {
              environment,
              error: error instanceof Error ? error.name : "unknown_error",
            });
            return jsonError(
              "Your subscription could not be canceled, so your account was not deleted. Manage billing or contact support.",
              502,
            );
          }
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

        const deletion = await import("@/lib/project-deletion.server");
        try {
          await deletion.deleteOwnedProjectsBeforeAccountDeletion({
            admin: auth.supabaseAdmin,
            userId: auth.userId,
          });
        } catch (error) {
          console.error("[account-delete] project storage cleanup failed", {
            code:
              error instanceof deletion.ProjectDeletionError
                ? error.code
                : "project_deletion_failed",
          });
          return jsonError(
            "Project cleanup did not finish, so your account remains active. Some projects may already have been deleted; retry to resume safely.",
            503,
          );
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
