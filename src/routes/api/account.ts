import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/api-auth.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { disconnectGoogle } from "@/lib/google-oauth.server";

import type { Database } from "@/integrations/supabase/types";

const TERMINAL_SUBSCRIPTION_STATES = new Set(["canceled", "incomplete_expired"]);
const USER_PREFIX_STORAGE_BUCKETS = ["library-images", "agent-evidence"] as const;
const PROJECT_FILES_BUCKET = "project-files";
const STORAGE_LIST_LIMIT = 100;

type AdminClient = SupabaseClient<Database>;

async function listStoragePaths(
  supabaseAdmin: AdminClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, {
      limit: STORAGE_LIST_LIMIT,
      offset,
    });
    if (error) throw error;
    const entries = data ?? [];
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        paths.push(...(await listStoragePaths(supabaseAdmin, bucket, path)));
      } else {
        paths.push(path);
      }
    }
    if (entries.length < STORAGE_LIST_LIMIT) break;
    offset += STORAGE_LIST_LIMIT;
  }

  return paths;
}

async function removeStoragePaths(supabaseAdmin: AdminClient, bucket: string, paths: string[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < uniquePaths.length; i += STORAGE_LIST_LIMIT) {
    const chunk = uniquePaths.slice(i, i + STORAGE_LIST_LIMIT);
    const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk);
    if (error) throw error;
  }
}

async function deleteOwnedStorageObjects(supabaseAdmin: AdminClient, userId: string) {
  for (const bucket of USER_PREFIX_STORAGE_BUCKETS) {
    const paths = await listStoragePaths(supabaseAdmin, bucket, userId);
    await removeStoragePaths(supabaseAdmin, bucket, paths);
  }

  const { data: projects, error: projectsError } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("owner_id", userId);
  if (projectsError) throw projectsError;

  const projectIds = (projects ?? []).map((project) => project.id);
  if (projectIds.length === 0) return;

  const projectFilePaths: string[] = [];
  const { data: projectFiles, error: projectFilesError } = await supabaseAdmin
    .from("project_files")
    .select("storage_path")
    .in("project_id", projectIds);
  if (projectFilesError) throw projectFilesError;
  projectFilePaths.push(...(projectFiles ?? []).map((file) => file.storage_path));

  for (const projectId of projectIds) {
    projectFilePaths.push(
      ...(await listStoragePaths(supabaseAdmin, PROJECT_FILES_BUCKET, projectId)),
    );
  }

  await removeStoragePaths(supabaseAdmin, PROJECT_FILES_BUCKET, projectFilePaths);

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

        try {
          await deleteOwnedStorageObjects(auth.supabaseAdmin, auth.userId);
        } catch (error) {
          console.error("[account-delete] storage cleanup failed", {
            error: error instanceof Error ? error.message : "unknown_error",
          });
          return Response.json(
            { error: "Stored account files could not be deleted. Your account remains active." },
            { status: 500 },
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
