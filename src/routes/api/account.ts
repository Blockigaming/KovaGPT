import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { createStripeClient } from "@/lib/stripe.server";
import { disconnectAllGoogle } from "@/lib/google-oauth.server";
import { disconnectAllGitHub } from "@/lib/github-oauth.server";
import { disconnectAllOAuth } from "@/integrations/oauth-lifecycle.server";
import { disconnectAllFinance } from "@/finances/plaid.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BodyReadError, readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import {
  cleanupAccountExportsBeforeAccountDeletion,
  hasAccountDeletionFence,
  releaseAccountExportDeletionFence,
} from "@/lib/account-export.server";
import { prepareStripeAccountDeletion } from "@/lib/stripe-account-deletion-preflight.mjs";
import { retireStripeCustomerForAccountDeletion } from "@/lib/stripe-account-deletion.mjs";
import { cleanupOwnedStorageBeforeAccountDeletion } from "@/lib/account-storage-cleanup.server";
import { prepareAccountStorageArtifactDeletion } from "@/lib/account-storage-artifacts.server";

import {
  prepareOrganizationAccountDeletion,
  OrganizationAccountDeletionError,
} from "@/lib/organization-account-deletion.server";

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

        let preparedBilling: Awaited<ReturnType<typeof prepareStripeAccountDeletion>> = [];
        let deletionFailure: Response | null = null;
        let destructiveCleanupStarted: boolean;
        try {
          destructiveCleanupStarted = await hasAccountDeletionFence(auth.userId);
        } catch {
          return jsonError("Account deletion state could not be verified. Retry shortly.", 503);
        }
        try {
          await prepareOrganizationAccountDeletion(auth.supabaseAdmin, auth.userId);
        } catch (error) {
          const transferRequired =
            error instanceof OrganizationAccountDeletionError && error.status === 409;
          deletionFailure = Response.json(
            {
              error: transferRequired
                ? "Transfer organization ownership to another active owner before deleting your account."
                : "Organization ownership could not be verified. Your account was not deleted; retry shortly.",
              code: transferRequired
                ? "organization_ownership_transfer_required"
                : "organization_deletion_preflight_unavailable",
            },
            { status: transferRequired ? 409 : 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        if (!deletionFailure) {
          try {
            const exportCleanup = await cleanupAccountExportsBeforeAccountDeletion(auth.userId);
            if (!exportCleanup.ready) {
              deletionFailure = Response.json(
                {
                  error:
                    "Account export cleanup is still in progress. Your account was not deleted; retry shortly.",
                  code: "account_export_cleanup_pending",
                },
                {
                  status: 409,
                  headers: { "Cache-Control": "no-store", "Retry-After": "5" },
                },
              );
            }
          } catch (error) {
            console.error("[account-delete] account export cleanup failed", {
              error: error instanceof Error ? error.name : "unknown_error",
            });
            deletionFailure = Response.json(
              {
                error:
                  "Private export data could not be removed, so your account was not deleted. Retry shortly.",
                code: "account_export_cleanup_failed",
              },
              {
                status: 503,
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
              "Billing deletion is still being verified. Retry Checkout or contact support before deleting the account.",
              409,
            );
          }
        }

        // Supabase Auth refuses to delete users who still own Storage objects.
        // Project files and agent evidence must be exhausted before Library
        // images begin so another bucket cannot strand an active account whose
        // Library bytes have already been removed. Cleanup is bounded and
        // retryable; metadata is released only after its Storage object.
        if (!deletionFailure) {
          try {
            const uploadsReady = await prepareAccountStorageArtifactDeletion(auth.userId);
            let storageCleanup: { complete: boolean } = { complete: false };
            if (uploadsReady) {
              // From this point onward, retries must resume behind the durable
              // deletion fence: Project and Storage removal is irreversible.
              destructiveCleanupStarted = true;
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
                    "Private file cleanup is still in progress. Your account was not deleted; retry shortly.",
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
              "Private files could not be removed, so your account was not deleted. Please try again.",
              503,
            );
          }
        }

        // Finish retryable export/file cleanup before canceling paid service
        // or disconnecting integrations. A cleanup 409 must not strip an
        // otherwise-active account of subscriptions and connected accounts.
        if (!deletionFailure) {
          const removeExternalServices = async (): Promise<Response | null> => {
            for (const billing of preparedBilling) {
              try {
                await retireStripeCustomerForAccountDeletion(billing);
              } catch {
                return jsonError(
                  "Billing could not be retired, so your account was not deleted. Retry shortly or contact support.",
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
              await disconnectAllGoogle(auth.userId);
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

            return null;
          };
          deletionFailure = await removeExternalServices();
        }

        if (!deletionFailure) {
          try {
            const { error: deleteError } = await auth.supabaseAdmin.auth.admin.deleteUser(
              auth.userId,
            );
            if (deleteError) {
              console.error("[account-delete] auth deletion failed", {
                code: deleteError.code,
              });
              deletionFailure = jsonError(
                "Account deletion failed. Your account remains active.",
                500,
              );
            }
          } catch (error) {
            console.error("[account-delete] auth deletion request failed", {
              error: error instanceof Error ? error.name : "unknown_error",
            });
            deletionFailure = jsonError(
              "Account deletion failed. Your account remains active.",
              500,
            );
          }
        }

        if (deletionFailure && !destructiveCleanupStarted) {
          // cleanupAccountExportsBeforeAccountDeletion inserts a durable fence.
          // Before irreversible cleanup starts, remove it again so an intact
          // account retains normal access and export availability.
          try {
            await releaseAccountExportDeletionFence(auth.userId);
          } catch (error) {
            console.error("[account-delete] export fence release failed", {
              error: error instanceof Error ? error.name : "unknown_error",
            });
            return Response.json(
              {
                error:
                  "Account deletion paused, but account exports could not be re-enabled. Retry account deletion shortly.",
                code: "account_export_fence_release_failed",
              },
              {
                status: 503,
                headers: { "Cache-Control": "no-store", "Retry-After": "5" },
              },
            );
          }
        }

        if (deletionFailure) return deletionFailure;

        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
