import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { disconnectGoogle } from "@/lib/google-oauth.server";

const TERMINAL_SUBSCRIPTION_STATES = new Set(["canceled", "incomplete_expired"]);
const ACCOUNT_DELETION_BAN_DURATION = "876000h";

type DeletionProgress = {
  requestedAt: string;
  billingCanceledSubscriptionIds: string[];
  billingCancellationFailedSubscriptionIds: string[];
  billingComplete: boolean;
  googleDisconnected: boolean;
  authDeleteAttemptedAt?: string;
  authDeleteFailedAt?: string;
};

type AuthAdmin = {
  getUserById: (userId: string) => Promise<{
    data: { user: { app_metadata?: Record<string, unknown> } | null };
    error: { message?: string; code?: string } | null;
  }>;
  updateUserById: (
    userId: string,
    attributes: {
      ban_duration?: string;
      app_metadata?: Record<string, unknown>;
    },
  ) => Promise<{ error: { message?: string; code?: string } | null }>;
  deleteUser: (userId: string) => Promise<{ error: { message?: string; code?: string } | null }>;
};

function mergeUnique(values: string[], next: string) {
  return values.includes(next) ? values : [...values, next];
}

function readExistingDeletionProgress(value: unknown): DeletionProgress | null {
  if (!value || typeof value !== "object") return null;
  const progress = (value as { account_deletion?: unknown }).account_deletion;
  if (!progress || typeof progress !== "object") return null;
  const candidate = progress as Partial<DeletionProgress>;
  return {
    requestedAt:
      typeof candidate.requestedAt === "string" ? candidate.requestedAt : new Date().toISOString(),
    billingCanceledSubscriptionIds: Array.isArray(candidate.billingCanceledSubscriptionIds)
      ? candidate.billingCanceledSubscriptionIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    billingCancellationFailedSubscriptionIds: Array.isArray(
      candidate.billingCancellationFailedSubscriptionIds,
    )
      ? candidate.billingCancellationFailedSubscriptionIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    billingComplete: candidate.billingComplete === true,
    googleDisconnected: candidate.googleDisconnected === true,
    authDeleteAttemptedAt:
      typeof candidate.authDeleteAttemptedAt === "string"
        ? candidate.authDeleteAttemptedAt
        : undefined,
    authDeleteFailedAt:
      typeof candidate.authDeleteFailedAt === "string" ? candidate.authDeleteFailedAt : undefined,
  };
}

async function saveDeletionProgress(
  authAdmin: AuthAdmin,
  userId: string,
  progress: DeletionProgress,
  options: { banUser?: boolean } = {},
) {
  const { error } = await authAdmin.updateUserById(userId, {
    ...(options.banUser ? { ban_duration: ACCOUNT_DELETION_BAN_DURATION } : {}),
    app_metadata: {
      account_deletion: progress,
    },
  });
  if (error) {
    console.error("[account-delete] deletion progress update failed", { code: error.code });
    return false;
  }
  return true;
}

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

        const authAdmin = auth.supabaseAdmin.auth.admin as AuthAdmin;
        const existingUser = await authAdmin.getUserById(auth.userId);
        const deletionProgress: DeletionProgress = readExistingDeletionProgress(
          existingUser.data.user?.app_metadata,
        ) ?? {
          requestedAt: new Date().toISOString(),
          billingCanceledSubscriptionIds: [],
          billingCancellationFailedSubscriptionIds: [],
          billingComplete: false,
          googleDisconnected: false,
        };
        if (!(await saveDeletionProgress(authAdmin, auth.userId, deletionProgress))) {
          return Response.json(
            { error: "Account deletion could not be started. Please try again." },
            { status: 503 },
          );
        }

        // Stop paid service before deleting the auth user. Progress is recorded
        // before and after each irreversible Stripe cancellation so a retry is
        // resumable and never reports the account as simply active after a
        // partial deletion attempt.
        const { data: subscriptions, error: subscriptionError } = await auth.supabaseAdmin
          .from("subscriptions")
          .select("stripe_subscription_id, status, environment")
          .eq("user_id", auth.userId);
        if (subscriptionError) {
          return Response.json(
            { error: "Billing status could not be verified. Account deletion is pending." },
            { status: 503 },
          );
        }
        for (const subscription of subscriptions ?? []) {
          if (TERMINAL_SUBSCRIPTION_STATES.has(subscription.status)) continue;
          if (!subscription.stripe_subscription_id) continue;
          if (
            deletionProgress.billingCanceledSubscriptionIds.includes(
              subscription.stripe_subscription_id,
            )
          ) {
            continue;
          }
          const environment: StripeEnv = subscription.environment === "live" ? "live" : "sandbox";
          try {
            await createStripeClient(environment).subscriptions.cancel(
              subscription.stripe_subscription_id,
            );
            deletionProgress.billingCanceledSubscriptionIds = mergeUnique(
              deletionProgress.billingCanceledSubscriptionIds,
              subscription.stripe_subscription_id,
            );
            await saveDeletionProgress(authAdmin, auth.userId, deletionProgress);
          } catch (error) {
            deletionProgress.billingCancellationFailedSubscriptionIds = mergeUnique(
              deletionProgress.billingCancellationFailedSubscriptionIds,
              subscription.stripe_subscription_id,
            );
            await saveDeletionProgress(authAdmin, auth.userId, deletionProgress);
            console.error("[account-delete] subscription cancellation failed", {
              environment,
              error: error instanceof Error ? error.name : "unknown_error",
            });
            return Response.json(
              {
                error:
                  "Account deletion is pending after partial progress. A subscription could not be canceled, so your account was not deleted yet; retry deletion or contact support.",
                pending: true,
              },
              { status: 202 },
            );
          }
        }
        deletionProgress.billingComplete = true;
        await saveDeletionProgress(authAdmin, auth.userId, deletionProgress, { banUser: true });

        try {
          await disconnectGoogle(auth.userId);
          deletionProgress.googleDisconnected = true;
          await saveDeletionProgress(authAdmin, auth.userId, deletionProgress, { banUser: true });
        } catch (error) {
          console.error("[account-delete] Google revocation failed", {
            error: error instanceof Error ? error.name : "unknown_error",
          });
        }

        deletionProgress.authDeleteAttemptedAt = new Date().toISOString();
        await saveDeletionProgress(authAdmin, auth.userId, deletionProgress, { banUser: true });
        const { error: deleteError } = await auth.supabaseAdmin.auth.admin.deleteUser(auth.userId);
        if (deleteError) {
          deletionProgress.authDeleteFailedAt = new Date().toISOString();
          await saveDeletionProgress(authAdmin, auth.userId, deletionProgress, { banUser: true });
          console.error("[account-delete] auth deletion failed", { code: deleteError.code });
          return Response.json(
            {
              error:
                "Account deletion is pending after billing cancellation. Contact support if this does not complete shortly.",
              pending: true,
            },
            { status: 202 },
          );
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
