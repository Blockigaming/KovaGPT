import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { disconnectGoogle } from "@/lib/google-oauth.server";
import { disconnectAllOAuth } from "@/integrations/oauth-lifecycle.server";

const TERMINAL_SUBSCRIPTION_STATES = new Set(["canceled", "incomplete_expired"]);

export const Route = createFileRoute("/api/account")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 1_024) {
          return Response.json({ error: "Request too large." }, { status: 413 });
        }
        const raw = await request.text();
        if (raw.length > 1_024) {
          return Response.json({ error: "Request too large." }, { status: 413 });
        }
        let confirmation: unknown;
        try {
          confirmation = (JSON.parse(raw) as { confirmation?: unknown }).confirmation;
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }
        if (confirmation !== "DELETE") {
          return Response.json(
            { error: "Type DELETE to confirm account deletion." },
            { status: 400 },
          );
        }

        // Stop paid service before deleting the auth user. If billing cannot be
        // verified or canceled, keep the account intact so no one can be billed
        // after losing access to the billing portal.
        const { data: subscriptions, error: subscriptionError } = await auth.supabaseAdmin
          .from("subscriptions")
          .select("stripe_subscription_id, status, environment")
          .eq("user_id", auth.userId);
        if (subscriptionError) {
          return Response.json(
            { error: "Billing status could not be verified. Please try again." },
            { status: 503 },
          );
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
            return Response.json(
              {
                error:
                  "Your subscription could not be canceled, so your account was not deleted. Manage billing or contact support.",
              },
              { status: 502 },
            );
          }
        }

        try {
          await disconnectGoogle(auth.userId);
        } catch (error) {
          console.error("[account-delete] Google revocation failed", {
            error: error instanceof Error ? error.name : "unknown_error",
          });
        }

        try {
          await disconnectAllOAuth(auth.userId);
        } catch (error) {
          console.error("[account-delete] linked account disconnection failed", {
            error: error instanceof Error ? error.message : "unknown_error",
          });
          return Response.json(
            {
              error:
                "Connected accounts could not be disconnected, so your account was not deleted. Please try again.",
            },
            { status: 503 },
          );
        }

        const { error: deleteError } = await auth.supabaseAdmin.auth.admin.deleteUser(auth.userId);
        if (deleteError) {
          console.error("[account-delete] auth deletion failed", { code: deleteError.code });
          return Response.json(
            { error: "Account deletion failed. Your account remains active." },
            { status: 500 },
          );
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
