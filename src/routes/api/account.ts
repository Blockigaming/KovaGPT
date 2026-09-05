import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { createStripeClient } from "@/lib/stripe.server";
import { disconnectAllGoogle } from "@/lib/google-oauth.server";
import { disconnectAllGitHub } from "@/lib/github-oauth.server";
import { disconnectAllOAuth } from "@/integrations/oauth-lifecycle.server";
import { disconnectAllFinance } from "@/finances/plaid.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { cleanupAccountExportsBeforeAccountDeletion } from "@/lib/account-export.server";
import { readAccountDeletionState } from "@/lib/account-deletion-state.server";
import { prepareStripeAccountDeletion } from "@/lib/stripe-account-deletion-preflight.mjs";
import { retireStripeCustomerForAccountDeletion } from "@/lib/stripe-account-deletion.mjs";
import { cleanupOwnedStorageBeforeAccountDeletion } from "@/lib/account-storage-cleanup.server";
import {
  prepareAccountStorageArtifactDeletion,
  prepareLibraryOriginalDeletion,
} from "@/lib/account-storage-artifacts.server";
import { cleanupWorkRunnerOwner } from "@/lib/work-runner.server";

import {
  prepareOrganizationAccountDeletion,
  OrganizationAccountDeletionError,
} from "@/lib/organization-account-deletion.server";

const MAX_DELETE_BODY_BYTES = 1_024;

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function deletionComplete() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
function deletionPending(
  error: string,
  status: number,
  state: "deleting" | "unknown" = "deleting",
  code = "account_deletion_pending",
) {
  return Response.json(
    { error, code, state, retryable: true },
    {
      status,
      headers: { "Cache-Control": "no-store", "Retry-After": "5" },
    },
  );
}

export const Route = createFileRoute("/api/account")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        if (request.headers.get("X-Kova-Expected-User") !== auth.userId)
          return jsonError("Your account changed. Reload and retry.", 409);
        try {
          return Response.json(await readAccountDeletionState(auth.supabaseAdmin, auth.userId), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          return deletionPending(
            "Deletion status could not be verified. Retry shortly.",
            503,
            "unknown",
          );
        }
      },
      DELETE: async ({ request }) => {
        if (isCrossSiteMutation(request)) {
          return jsonError("Cross-site account changes are not allowed.", 403);
        }
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        if (request.headers.get("X-Kova-Expected-User") !== auth.userId)
          return jsonError("Your account changed. Reload and retry.", 409);

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

        let priorState;
        try {
          priorState = await readAccountDeletionState(auth.supabaseAdmin, auth.userId);
        } catch {
          return deletionPending(
            "Deletion status could not be verified. Retry shortly.",
            503,
            "unknown",
          );
        }
        if (priorState.state === "deleted") return deletionComplete();
        if (priorState.state === "active") {
          try {
            // This RPC checks organization ownership and the funding trigger
            // before atomically inserting the first irreversible fence.
            await prepareOrganizationAccountDeletion(auth.supabaseAdmin, auth.userId);
          } catch (error) {
            let observed;
            try {
              observed = await readAccountDeletionState(auth.supabaseAdmin, auth.userId);
            } catch {
              return deletionPending(
                "Deletion may have started. Check its status and retry shortly.",
                503,
                "unknown",
              );
            }
            if (observed.state === "deleted") return deletionComplete();
            if (observed.state === "deleting")
              return deletionPending(
                "Account deletion has started. Retry shortly to continue cleanup.",
                503,
              );
            const code =
              error instanceof OrganizationAccountDeletionError
                ? error.code
                : "organization_deletion_preflight_unavailable";
            const paymentPending = code === "developer_payment_reconciliation_pending";
            const transferRequired = code === "organization_ownership_transfer_required";
            return Response.json(
              {
                error: paymentPending
                  ? "A developer credit payment is still pending. Check payment status in the developer console before deleting your account."
                  : transferRequired
                    ? "Transfer organization ownership to another active owner before deleting your account."
                    : "Deletion could not start because organization ownership could not be verified. Retry shortly.",
                code,
                state: "active",
              },
              {
                status: paymentPending || transferRequired ? 409 : 503,
                headers: { "Cache-Control": "no-store" },
              },
            );
          }
        }
        // An existing fence is a durable continuation, never a fresh admission.
        let preparedBilling: Awaited<ReturnType<typeof prepareStripeAccountDeletion>> = [];
        let deletionFailure: Response | null = null;
        let authDeletionAttempted = false;
        if (!deletionFailure) {
          try {
            const exportCleanup = await cleanupAccountExportsBeforeAccountDeletion(auth.userId);
            if (!exportCleanup.ready) {
              deletionFailure = Response.json(
                {
                  error:
                    "Account export cleanup is still in progress. Account deletion is pending; retry shortly to continue cleanup.",
                  code: "account_export_cleanup_pending",
                },
                {
                  status: 409,
                  headers: { "Cache-Control": "no-store", "Retry-After": "5" },
                },
              );
            }
          } catch (error) {
            const paymentPending =
              error instanceof Error &&
              error.message === "developer_payment_reconciliation_pending";
            console.error("[account-delete] account export cleanup failed", {
              error: error instanceof Error ? error.name : "unknown_error",
            });
            deletionFailure = Response.json(
              {
                error: paymentPending
                  ? "A developer credit payment is still pending. Check payment status in the developer console before deleting your account."
                  : "Private export data could not be removed, so deletion is pending. Retry shortly.",
                code: paymentPending
                  ? "developer_payment_reconciliation_pending"
                  : "account_export_cleanup_failed",
              },
              {
                status: paymentPending ? 409 : 503,
                headers: { "Cache-Control": "no-store", "Retry-After": "5" },
              },
            );
          }
        }

        // Fence first, then snapshot mappings: a prior authenticated Checkout
        // cannot introduce an unregistered Customer after this preflight.
        if (!deletionFailure) {
          try {
            preparedBilling = await prepareStripeAccountDeletion({
              supabase: auth.supabaseAdmin,
              userId: auth.userId,
              createStripeClient,
            });
          } catch {
            deletionFailure = jsonError(
              "Billing deletion is still being verified. Retry account deletion shortly or contact support.",
              409,
            );
          }
        }

        // Stop remote Work and erase its private attempt bytes before deleting
        // the metadata needed to identify them. Uncertain cleanup remains retryable.
        if (!deletionFailure) {
          try {
            const workCleanup = await cleanupWorkRunnerOwner(auth.userId);
            if (!workCleanup.complete)
              deletionFailure = Response.json(
                {
                  error:
                    "Private Work cleanup is still in progress. Retry account deletion shortly.",
                  code: "account_work_cleanup_pending",
                },
                { status: 409, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
              );
          } catch {
            deletionFailure = jsonError(
              "Private Work data could not be removed, so deletion is pending. Retry shortly.",
              503,
            );
          }
        }

        // Supabase Auth refuses to delete users who still own Storage objects.
        // Project files and agent evidence must be exhausted before Library
        // images begin so another bucket cannot strand a deleting account whose
        // Library bytes have already been removed. Cleanup is bounded and
        // retryable; metadata is released only after its Storage object.
        if (!deletionFailure) {
          try {
            const originalsReady = await prepareLibraryOriginalDeletion(auth.userId);
            const uploadsReady = await prepareAccountStorageArtifactDeletion(auth.userId);
            let storageCleanup: { complete: boolean } = { complete: false };
            if (uploadsReady && originalsReady) {
              const { deleteOwnedProjectsBeforeAccountDeletion } =
                await import("@/lib/project-deletion.server");
              await deleteOwnedProjectsBeforeAccountDeletion({
                admin: auth.supabaseAdmin,
                userId: auth.userId,
              });
              storageCleanup = await cleanupOwnedStorageBeforeAccountDeletion(
                auth.supabaseAdmin,
                auth.userId,
              );
            }
            if (!storageCleanup.complete) {
              deletionFailure = Response.json(
                {
                  error:
                    "Private file cleanup is still in progress. Account deletion is pending; retry shortly to continue cleanup.",
                  code: "account_storage_cleanup_pending",
                },
                {
                  status: 409,
                  headers: { "Cache-Control": "no-store", "Retry-After": "5" },
                },
              );
            }
          } catch (error) {
            console.error("[account-delete] private Storage cleanup failed", {
              error: error instanceof Error ? error.name : "unknown_error",
            });
            deletionFailure = jsonError(
              "Private files could not be removed, so deletion is pending. Please try again.",
              503,
            );
          }
        }

        // Finish retryable export/file cleanup before canceling paid service
        // or disconnecting integrations. A cleanup 409 must not strip an
        // deleting account of subscriptions and connected accounts prematurely.
        if (!deletionFailure) {
          const removeExternalServices = async (): Promise<Response | null> => {
            for (const billing of preparedBilling) {
              try {
                await retireStripeCustomerForAccountDeletion(billing);
              } catch {
                return jsonError(
                  "Billing could not be retired, so deletion is pending. Retry shortly or contact support.",
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
                "Financial connections could not be removed, so deletion is pending. Please try again or contact support.",
                502,
              );
            }

            try {
              await disconnectAllGoogle(auth.userId);
            } catch (error) {
              console.error("[account-delete] Google token purge failed", {
                error: error instanceof Error ? error.name : "unknown_error",
              });
              return jsonError(
                "Google credentials could not be removed, so deletion is pending. Please try again.",
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
                "GitHub credentials could not be removed, so deletion is pending. Please try again.",
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
                "Connected accounts could not be disconnected, so deletion is pending. Please try again.",
                503,
              );
            }

            return null;
          };
          deletionFailure = await removeExternalServices();
        }

        if (!deletionFailure) {
          try {
            authDeletionAttempted = true;
            const { error: deleteError } = await auth.supabaseAdmin.auth.admin.deleteUser(
              auth.userId,
            );
            if (deleteError) {
              console.error("[account-delete] auth deletion failed", {
                code: deleteError.code,
              });
              deletionFailure = jsonError(
                "The final account deletion could not be verified. Retry shortly; cleanup already performed cannot be undone.",
                500,
              );
            }
          } catch (error) {
            console.error("[account-delete] auth deletion request failed", {
              error: error instanceof Error ? error.name : "unknown_error",
            });
            deletionFailure = jsonError(
              "The final account deletion could not be verified. Retry shortly; cleanup already performed cannot be undone.",
              500,
            );
          }
        }

        if (deletionFailure && authDeletionAttempted) {
          try {
            if (
              (await readAccountDeletionState(auth.supabaseAdmin, auth.userId)).state === "deleted"
            )
              return deletionComplete();
          } catch {
            /* Keep the irreversible pending state on an ambiguous reply. */
          }
        }

        if (deletionFailure) {
          const detail = (await deletionFailure.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          return deletionPending(
            detail?.error ?? "Account deletion is still pending. Retry shortly.",
            deletionFailure.status,
            "deleting",
            detail?.code,
          );
        }
        return deletionComplete();
      },
    },
  },
});
