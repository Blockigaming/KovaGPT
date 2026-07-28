import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createInstallationToken, listGitHubAppInstallations } from "@/lib/github-oauth.server";
/* eslint-disable @typescript-eslint/no-explicit-any -- Mercury tables are available after generated types refresh. */
export type GitHubManagement = {
  configured: boolean;
  accounts: any[];
  installations: any[];
  repositories: any[];
  health: "healthy" | "degraded" | "reconnect_required" | "credentials_not_configured";
};
export const getGitHubManagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GitHubManagement> => {
    const configured = Boolean(
      process.env.GITHUB_OAUTH_CLIENT_ID &&
      process.env.GITHUB_OAUTH_CLIENT_SECRET &&
      process.env.CONNECTOR_ENCRYPTION_KEY,
    );
    if (!configured)
      return {
        configured: false,
        accounts: [],
        installations: [],
        repositories: [],
        health: "credentials_not_configured",
      };
    const [accounts, installations, repositories] = await Promise.all([
      (supabaseAdmin as any)
        .from("github_accounts")
        .select(
          "id,auth_type,github_user_id,login,avatar_url,status,scopes,rate_limit,rate_remaining,rate_reset_at,last_health_at,last_refresh_at,token_expires_at,created_at",
        )
        .eq("owner_id", context.userId)
        .order("created_at"),
      (supabaseAdmin as any)
        .from("github_installations")
        .select("*")
        .eq("owner_id", context.userId)
        .order("updated_at", { ascending: false }),
      (supabaseAdmin as any)
        .from("github_repositories")
        .select(
          "id,installation_id,full_name,organization_login,visibility,default_branch,permissions,explicitly_granted,archived,last_sync_at,last_webhook_at,revoked_at,updated_at",
        )
        .eq("owner_id", context.userId)
        .order("full_name"),
    ]);
    const rows = accounts.data ?? [],
      health = rows.some(
        (item: any) => item.status === "reauthorization_required" || item.status === "revoked",
      )
        ? "reconnect_required"
        : rows.some((item: any) => item.status === "degraded")
          ? "degraded"
          : "healthy";
    return {
      configured,
      accounts: rows,
      installations: installations.data ?? [],
      repositories: repositories.data ?? [],
      health,
    };
  });
export const refreshGitHubInstallations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const available = (await listGitHubAppInstallations()) as any[];
    const accounts = await (supabaseAdmin as any)
      .from("github_accounts")
      .select("id")
      .eq("owner_id", context.userId)
      .limit(1)
      .single();
    if (accounts.error) throw new Error("Connect GitHub before selecting an installation");
    for (const installation of available) {
      const token = await createInstallationToken(installation.id);
      await (supabaseAdmin as any).from("github_installations").upsert({
        id: installation.id,
        account_id: accounts.data.id,
        owner_id: context.userId,
        organization_id: installation.account?.id,
        organization_login: installation.account?.login,
        repository_selection: installation.repository_selection,
        permissions: token.permissions,
        events: installation.events ?? [],
        suspended_at: installation.suspended_at,
        updated_at: new Date().toISOString(),
      });
      const response = await fetch(
        `https://api.github.com/installation/repositories?per_page=100`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token.token}`,
            "x-github-api-version": "2022-11-28",
          },
        },
      );
      if (!response.ok) throw new Error("Unable to load installation repositories");
      const payload = (await response.json()) as any;
      for (const repo of payload.repositories ?? [])
        await (supabaseAdmin as any).from("github_repositories").upsert(
          {
            id: repo.id,
            owner_id: context.userId,
            account_id: accounts.data.id,
            installation_id: installation.id,
            full_name: String(repo.full_name).toLowerCase(),
            organization_login: repo.owner?.login,
            visibility: repo.visibility,
            default_branch: repo.default_branch,
            permissions: repo.permissions ?? {},
            archived: repo.archived,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
    }
    return { count: available.length };
  });
export const updateGitHubRepositoryGrants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        repositoryIds: z.array(z.number().int().positive()).max(500),
        granted: z.boolean(),
        confirmed: z.boolean().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    if (!data.granted && data.repositoryIds.length > 1 && !data.confirmed)
      throw new Error("Bulk revocation requires confirmation");
    const owned = await (supabaseAdmin as any)
      .from("github_repositories")
      .select("id,installation_id")
      .eq("owner_id", context.userId)
      .in("id", data.repositoryIds);
    if (owned.error || owned.data.length !== data.repositoryIds.length)
      throw new Error("Repository grant verification failed");
    const now = new Date().toISOString();
    await (supabaseAdmin as any)
      .from("github_repositories")
      .update({
        explicitly_granted: data.granted,
        revoked_at: data.granted ? null : now,
        updated_at: now,
      })
      .eq("owner_id", context.userId)
      .in("id", data.repositoryIds);
    if (!data.granted) {
      await (supabaseAdmin as any)
        .from("github_coding_selections")
        .delete()
        .eq("owner_id", context.userId)
        .in("repository_id", data.repositoryIds);
      await (supabaseAdmin as any)
        .from("github_sync_records")
        .update({ deletion_at: now })
        .eq("owner_id", context.userId)
        .in("repository_id", data.repositoryIds);
    }
    return { updated: data.repositoryIds.length };
  });
export const disconnectGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z.object({ accountId: z.string().uuid(), removeData: z.boolean() }).parse(value),
  )
  .handler(async ({ data, context }) => {
    const account = await (supabaseAdmin as any)
      .from("github_accounts")
      .select("id")
      .eq("id", data.accountId)
      .eq("owner_id", context.userId)
      .single();
    if (account.error) throw new Error("GitHub account not found");
    await (supabaseAdmin as any).rpc("disconnect_github_account", {
      p_account_id: data.accountId,
      p_remove_data: data.removeData,
    });
    if (data.removeData)
      await (supabaseAdmin as any)
        .from("github_sync_records")
        .delete()
        .eq("owner_id", context.userId);
    return { ok: true, remoteRevocation: "not_attempted" };
  });
