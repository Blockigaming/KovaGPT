// Current launch is Supabase; no owned-Auth grants, credentials or session lifecycle changes.
import type { AuthedCaller } from "@/lib/api-auth.server";
import { prepareAccountDeletionNotification } from "@/lib/account-email-lifecycle.server.mjs";
import { createStripeClient } from "@/lib/stripe.server";
import { disconnectAllGoogle } from "@/lib/google-oauth.server";
import { disconnectAllGitHub } from "@/lib/github-oauth.server";
import { disconnectAllOAuth } from "@/integrations/oauth-lifecycle.server";
import { disconnectAllFinance } from "@/finances/plaid.server";
import { cleanupAccountExportsBeforeAccountDeletion } from "@/lib/account-export.server";
import { retireStripeCustomerForAccountDeletion } from "@/lib/stripe-account-deletion.mjs";
import { cleanupOwnedStorageBeforeAccountDeletion } from "@/lib/account-storage-cleanup.server";
import {
  prepareAccountStorageArtifactDeletion,
  prepareLibraryOriginalDeletion,
} from "@/lib/account-storage-artifacts.server";
import { cleanupWorkRunnerOwner } from "@/lib/work-runner.server";
import {
  OrganizationAccountDeletionError,
  prepareOrganizationAccountDeletion,
} from "@/lib/organization-account-deletion.server";
import {
  renewAccountFinalization,
  acknowledgePolicyCustomerRetired,
  confirmAccountFinalization,
  validateAccountFinalizationClaim,
  type AccountFinalizationClaim,
} from "@/lib/account-lifecycle-policy.mjs";

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
function deletionComplete() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
function deletionPending(
  error: string,
  status: number,
  state = "deleting",
  code = "account_deletion_pending",
) {
  return Response.json(
    { error, code, state, retryable: true },
    { status, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
  );
}
async function authUserDeletionIsVerified(auth: AuthedCaller) {
  const result = await auth.supabaseAdmin.auth.admin.getUserById(auth.userId);
  return result.error?.status === 404 && result.error.code === "user_not_found";
}
export type FinalizationClaim = AccountFinalizationClaim;

/** Invoked only by the separately authenticated worker AFTER PostgreSQL claims a due account. */
export async function finalizeAccountAfterRecovery(
  auth: AuthedCaller,
  claim: FinalizationClaim,
): Promise<Response> {
  if (auth.authProvider !== "supabase")
    return jsonError("Owned Auth finalization remains a separate cutover.", 503);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(auth.userId))
    return jsonError("Account finalization binding is invalid.", 503);
  try {
    validateAccountFinalizationClaim(claim);
  } catch {
    return jsonError("Account finalization binding is invalid.", 503);
  }
  await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
  // Preserve organization/funding protection; unavailable dependencies fail closed.
  try {
    await prepareOrganizationAccountDeletion(auth.supabaseAdmin, auth.userId);
  } catch (error) {
    const code =
      error instanceof OrganizationAccountDeletionError &&
      error.status === 409 &&
      [
        "organization_ownership_transfer_required",
        "developer_payment_reconciliation_pending",
      ].includes(error.code)
        ? error.code
        : "organization_deletion_preflight_unavailable";
    return deletionPending(
      code === "organization_ownership_transfer_required"
        ? "Transfer organization ownership before final account cleanup."
        : code === "developer_payment_reconciliation_pending"
          ? "A developer credit payment still needs reconciliation before final account cleanup."
          : "Organization or funding cleanup prerequisites could not be verified.",
      code === "organization_deletion_preflight_unavailable" ? 503 : 409,
      "finalizing",
      code,
    );
  }
  // An existing fence is a durable continuation, never a fresh admission.
  let preparedBilling: Array<{
    stripe: ReturnType<typeof createStripeClient>;
    customerId: string;
    environment: "live" | "sandbox";
    retiredAt: string | null;
  }> = [];
  let deletionFailure: Response | null = null;
  let authDeletionAttempted = false;
  if (!deletionFailure) {
    await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
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
        error instanceof Error && error.message === "developer_payment_reconciliation_pending";
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
    await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
    try {
      const environments = new Set<string>();
      preparedBilling = claim.customers.map((mapping) => {
        if (
          !mapping ||
          !["live", "sandbox"].includes(mapping.environment) ||
          !/^cus_[A-Za-z0-9]+$/u.test(mapping.customerId) ||
          environments.has(mapping.environment) ||
          (mapping.retiredAt !== null &&
            (typeof mapping.retiredAt !== "string" ||
              !Number.isFinite(Date.parse(mapping.retiredAt))))
        )
          throw new Error("account_policy_customer_binding_invalid");
        environments.add(mapping.environment);
        return {
          stripe: createStripeClient(mapping.environment),
          customerId: mapping.customerId,
          environment: mapping.environment,
          retiredAt: mapping.retiredAt,
        };
      });
      // Reuse the bounded, zero-retry Stripe client. Verify every actual
      // Customer before deleting private Work or Storage, as the previous
      // deletion preflight did. A prior remote deletion is idempotent proof.
      for (const billing of preparedBilling) {
        const customer = await billing.stripe.customers.retrieve(billing.customerId);
        if (
          !customer ||
          customer.id !== billing.customerId ||
          (billing.retiredAt !== null && customer.deleted !== true)
        )
          throw new Error("account_policy_customer_preflight_unverified");
      }
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
    await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
    try {
      const workCleanup = await cleanupWorkRunnerOwner(auth.userId);
      if (!workCleanup.complete)
        deletionFailure = Response.json(
          {
            error: "Private Work cleanup is still in progress. Retry account deletion shortly.",
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
    await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
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
    await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
    const removeExternalServices = async (): Promise<Response | null> => {
      for (const billing of preparedBilling) {
        try {
          await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
          await retireStripeCustomerForAccountDeletion(billing);
          await acknowledgePolicyCustomerRetired(
            auth.supabaseAdmin,
            auth.userId,
            claim.attemptId,
            billing.environment,
            billing.customerId,
          );
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
    await renewAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
    try {
      authDeletionAttempted = true;
      let deleteError: { code?: string } | null = null;
      await confirmAccountFinalization(auth.supabaseAdmin, auth.userId, claim.attemptId);
      // Snapshot only after verified cleanup/policy confirmation. The outbox
      // remains held until actual Auth-user deletion commits; bridge cleanup
      // or an ambiguous delete response cannot assert final delivery.
      try {
        await prepareAccountDeletionNotification(auth.supabaseAdmin, auth.userId, claim.attemptId);
      } catch {
        // Optional mail cannot prevent a confirmed account deletion. Without a
        // prepared snapshot, the delete hook emits no final-account notice.
        console.warn("[account-delete] optional deletion notification unavailable", {
          code: "account_email_preparation_unconfirmed",
        });
      }
      deleteError = (await auth.supabaseAdmin.auth.admin.deleteUser(auth.userId)).error;
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
      if (await authUserDeletionIsVerified(auth)) return deletionComplete();
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
}
