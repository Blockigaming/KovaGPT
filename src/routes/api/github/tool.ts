import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { decryptSecret } from "@/lib/github-oauth.server";
import { GitHubClient } from "@/lib/github-connector.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { githubActionId, parseGitHubTool } from "@/lib/github-tool-policy";
import { z } from "zod";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";
/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub migration types are generated after deployment. */
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
const actionFields = "id,user_id,tool,args,status,result,summary,expires_at";
const isGitHubAction = (row: any) =>
  typeof row?.tool === "string" && row.tool.startsWith("github.");
const statusResult = (row: any) => ({
  ok: true,
  status:
    row.status === "pending" && Date.parse(row.expires_at) <= Date.now() ? "expired" : row.status,
  result_text: row.result?.text,
});
const accessSchema = z.enum(["none", "view", "write"]);
function accessFrom(row: any) {
  const settings = row?.settings ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("Invalid settings");
  return {
    mode: accessSchema.parse(settings.github_access_mode ?? "view"),
    revision: settings.github_access_revision ?? "initial",
    settings,
  };
}
async function readAccess(db: any, userId: string) {
  const result = await db
    .from("user_preferences")
    .select("settings,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw new Error("GitHub access settings unavailable");
  return { ...accessFrom(result.data), row: result.data };
}
export const Route = createFileRoute("/api/github/tool")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const db = auth.supabaseAdmin as any;
        const id = new URL(request.url).searchParams.get("action_id");
        let access;
        try {
          access = await readAccess(db, auth.userId);
        } catch {
          return json({ ok: false, error: "GitHub access settings unavailable" }, 503);
        }
        if (id) {
          if (!githubActionId.safeParse(id).success)
            return json({ ok: false, error: "Invalid action ID" }, 400);
          const { data, error } = await db
            .from("pending_tool_actions")
            .select(actionFields)
            .eq("id", id)
            .eq("user_id", auth.userId)
            .maybeSingle();
          if (error) return json({ ok: false, error: "GitHub action status unavailable" }, 503);
          if (!isGitHubAction(data)) return json({ ok: false, error: "Action not found" }, 404);
          return json(statusResult(data));
        }
        const { data, error } = await db
          .from("pending_tool_actions")
          .select(actionFields)
          .eq("user_id", auth.userId)
          .like("tool", "github.%")
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) return json({ ok: false, error: "GitHub approvals unavailable" }, 503);
        return json({
          ok: true,
          access_mode: access.mode,
          actions: (data ?? []).map((row: any) => ({
            actionId: row.id,
            tool: row.tool,
            summary: row.summary,
            status: "pending",
            argsPreview: {
              github_account: row.args.accountLogin,
              repository: row.args.repository,
              operation: row.args.tool,
              details: row.args.args,
            },
          })),
        });
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const db = auth.supabaseAdmin as any;
        let input: any,
          action: any = null;
        try {
          const body = await readBoundedJsonObject(request, 64 * 1024);
          if ("access_mode" in body) {
            const { access_mode } = z.object({ access_mode: accessSchema }).strict().parse(body);
            const access = await readAccess(db, auth.userId);
            const settings = {
              ...access.settings,
              github_access_mode: access_mode,
              github_access_revision: crypto.randomUUID(),
            };
            const update = access.row
              ? db
                  .from("user_preferences")
                  .update({ settings, updated_at: new Date().toISOString() })
                  .eq("user_id", auth.userId)
                  .eq("settings", JSON.stringify(access.settings))
                  .select("user_id")
                  .maybeSingle()
              : db
                  .from("user_preferences")
                  .insert({ user_id: auth.userId, settings })
                  .select("user_id")
                  .single();
            const saved = await update;
            if (saved.error || !saved.data)
              return json(
                {
                  ok: false,
                  error: "Settings changed or could not be saved. Reload and try again.",
                },
                409,
              );
            return json({ ok: true, access_mode });
          }
          if ("action_id" in body || "decision" in body) {
            const decision = z
              .object({ action_id: githubActionId, decision: z.enum(["confirm", "cancel"]) })
              .strict()
              .parse(body);
            const loaded = await db
              .from("pending_tool_actions")
              .select(actionFields)
              .eq("id", decision.action_id)
              .eq("user_id", auth.userId)
              .maybeSingle();
            if (loaded.error) return json({ ok: false, error: "GitHub approval unavailable" }, 503);
            action = loaded.data;
            if (!isGitHubAction(action)) return json({ ok: false, error: "Action not found" }, 404);
            if (decision.decision === "cancel") {
              if (action.status === "cancelled")
                return json({ ok: true, result_text: "Cancelled." });
              const cancelled = await db
                .from("pending_tool_actions")
                .update({ status: "cancelled" })
                .eq("id", action.id)
                .eq("user_id", auth.userId)
                .eq("status", "pending")
                .select("id")
                .maybeSingle();
              return cancelled.data && !cancelled.error
                ? json({ ok: true, result_text: "Cancelled." })
                : json({ ok: false, error: "Action is no longer pending" }, 409);
            }
            if (action.status === "confirmed")
              return json({ ok: true, result_text: action.result?.text });
            if (
              action.status !== "pending" ||
              !Number.isFinite(Date.parse(action.expires_at)) ||
              Date.parse(action.expires_at) <= Date.now()
            )
              return json({ ok: false, error: "Approval expired or already consumed" }, 409);
            input = parseGitHubTool({
              tool: action.args.tool,
              repository: action.args.repository,
              args: action.args.args,
            });
            if (!input.write || action.tool !== `github.${input.tool}`)
              return json({ ok: false, error: "Invalid approval binding" }, 409);
          } else {
            if ("confirmed" in body || "approvalId" in body)
              return json(
                {
                  ok: false,
                  error: "Explicit confirmation required: prepare the exact action first.",
                },
                409,
              );
            input = parseGitHubTool(body);
          }
        } catch (error) {
          if (error instanceof BoundedJsonError)
            return json({ ok: false, error: error.code }, error.status);
          return json({ ok: false, error: "Invalid GitHub request" }, 400);
        }
        const write = input.write;
        let access;
        try {
          access = await readAccess(db, auth.userId);
        } catch {
          return json({ ok: false, error: "GitHub access settings unavailable" }, 503);
        }
        if (access.mode === "none" || (write && access.mode !== "write"))
          return json(
            {
              ok: false,
              error:
                access.mode === "none"
                  ? "GitHub is temporarily disabled"
                  : "GitHub is set to View only",
            },
            403,
          );
        if (action && action.args.accessRevision !== access.revision)
          return json(
            { ok: false, error: "GitHub access changed. Prepare the action again." },
            409,
          );
        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          write ? "connector_write" : "connector_read",
        );
        if (lockdown) return lockdown;
        const repo = await (auth.supabaseAdmin as any)
          .from("github_repositories")
          .select(
            "id,full_name,account_id,permissions,default_branch,updated_at,installation_id,archived",
          )
          .eq("owner_id", auth.userId)
          .eq("full_name", String(input.repository).toLowerCase())
          .eq("explicitly_granted", true)
          .is("revoked_at", null)
          .single();
        if (repo.error || !repo.data)
          return json({ ok: false, error: "Repository is not authorized" }, 403);
        const account = await (auth.supabaseAdmin as any)
          .from("github_accounts")
          .select("id,token_ciphertext,status,login,updated_at")
          .eq("id", repo.data.account_id)
          .eq("owner_id", auth.userId)
          .single();
        if (
          account.error ||
          !account.data ||
          account.data.status !== "connected" ||
          !account.data.token_ciphertext
        )
          return json({ ok: false, error: "GitHub reconnect required" }, 401);
        const permissions = repo.data.permissions ?? {};
        if (write && permissions.push !== true && permissions.admin !== true)
          return json({ ok: false, error: "Repository write permission required" }, 403);
        if (repo.data.installation_id) {
          const installation = await db
            .from("github_installations")
            .select("id,suspended_at")
            .eq("id", repo.data.installation_id)
            .eq("owner_id", auth.userId)
            .eq("account_id", repo.data.account_id)
            .maybeSingle();
          if (installation.error || !installation.data || installation.data.suspended_at)
            return json({ ok: false, error: "GitHub installation is unavailable" }, 403);
        }
        if (write && repo.data.archived)
          return json({ ok: false, error: "Archived repository is read-only" }, 403);
        if (write && !action) {
          const binding = {
            tool: input.tool,
            args: input.args,
            repository: repo.data.full_name,
            repositoryId: repo.data.id,
            accountId: account.data.id,
            accountLogin: account.data.login,
            repositoryVersion: repo.data.updated_at,
            accountVersion: account.data.updated_at,
            defaultBranch: repo.data.default_branch,
            accessRevision: access.revision,
          };
          const summary = `${input.tool} in ${repo.data.full_name} as @${account.data.login}`;
          const staged = await db
            .from("pending_tool_actions")
            .insert({
              user_id: auth.userId,
              tool: `github.${input.tool}`,
              args: binding,
              summary,
            })
            .select("id")
            .single();
          if (staged.error || !staged.data)
            return json({ ok: false, error: "Could not prepare GitHub approval" }, 503);
          return json(
            {
              ok: true,
              approval_required: true,
              action: {
                actionId: staged.data.id,
                tool: `github.${input.tool}`,
                summary,
                status: "pending",
                argsPreview: {
                  github_account: account.data.login,
                  repository: repo.data.full_name,
                  operation: input.tool,
                  details: input.args,
                },
              },
            },
            202,
          );
        }
        if (
          action &&
          (action.args.repositoryId !== repo.data.id ||
            action.args.accountId !== account.data.id ||
            action.args.repositoryVersion !== repo.data.updated_at ||
            action.args.accountVersion !== account.data.updated_at ||
            action.args.defaultBranch !== repo.data.default_branch)
        )
          return json(
            { ok: false, error: "GitHub access changed. Prepare the action again." },
            409,
          );
        if (auth.revalidateSession && !(await auth.revalidateSession()))
          return json({ ok: false, error: "Session expired" }, 401);
        if (action) {
          const claimed = await db
            .from("pending_tool_actions")
            .update({ status: "processing" })
            .eq("id", action.id)
            .eq("user_id", auth.userId)
            .eq("status", "pending")
            .gt("expires_at", new Date().toISOString())
            .select("id")
            .maybeSingle();
          if (claimed.error || !claimed.data)
            return json({ ok: false, error: "Approval already consumed or unavailable" }, 409);
        }
        let success = false,
          result;
        try {
          // Recheck after the atomic claim: a concurrent settings change must
          // not turn an old pending card into new provider authority.
          if (action) {
            const currentAccess = await readAccess(db, auth.userId);
            if (
              currentAccess.mode !== "write" ||
              currentAccess.revision !== action.args.accessRevision
            )
              return json(
                {
                  ok: false,
                  error: "GitHub access changed before execution. Prepare the action again.",
                },
                409,
              );
          }
          const client = new GitHubClient({
            token: await decryptSecret(account.data.token_ciphertext),
            allowedRepositories: [repo.data.full_name],
          });
          const a = input.args ?? {},
            name = repo.data.full_name;
          switch (input.tool) {
            case "file":
              result = await client.file(name, a.path, a.ref);
              break;
            case "tree":
              result = await client.tree(name, a.ref);
              break;
            case "branches":
              result = await client.branches(name);
              break;
            case "commits":
              result = await client.commits(name);
              break;
            case "issues":
              result = await client.issues(name, a.state);
              break;
            case "pulls":
              result = await client.pulls(name, a.state);
              break;
            case "releases":
              result = await client.releases(name);
              break;
            case "workflows":
              result = await client.workflows(name);
              break;
            case "workflowRuns":
              result = await client.workflowRuns(name);
              break;
            case "checks":
              result = await client.checks(name, a.ref);
              break;
            case "discussions":
              result = await client.discussions(name);
              break;
            case "searchCode":
              result = await client.searchCode(name, a.query);
              break;
            case "createIssue":
              result = await client.createIssue(name, a, true);
              break;
            case "commentIssue":
              result = await client.commentIssue(name, a.number, a.body, true);
              break;
            case "createBranch":
              result = await client.createBranch(name, a.name, a.sha, true);
              break;
            case "openPull":
              result = await client.openPull(name, a, true);
              break;
            case "requestReview":
              result = await client.requestReview(name, a.number, a.reviewers, true);
              break;
            case "mergePull":
              result = await client.mergePull(name, a.number, a.input, true);
              break;
            case "proposePatch":
              result = await client.proposePatch(
                name,
                { ...a, defaultBranch: repo.data.default_branch },
                true,
              );
              break;
          }
          success = true;
          if (auth.revalidateSession && !(await auth.revalidateSession()))
            return json({ ok: false, error: "Session expired; check GitHub before retrying" }, 401);
          if (action) {
            const saved = await db
              .from("pending_tool_actions")
              .update({ status: "confirmed", result: { text: "GitHub action completed." } })
              .eq("id", action.id)
              .eq("user_id", auth.userId)
              .eq("status", "processing")
              .select("id")
              .maybeSingle();
            if (saved.error || !saved.data)
              return json(
                {
                  ok: false,
                  error: "GitHub outcome could not be saved. Check GitHub before any new action.",
                  error_code: "completion_persistence_ambiguous",
                },
                503,
              );
          }
          return json({
            ok: true,
            result,
            result_text: "GitHub action completed.",
            rateLimit: client.rateLimit,
          });
        } catch {
          // A failed network request may still have reached GitHub. Keep a write
          // consumed, never reset it to pending or automatically repeat it.
          return json(
            {
              ok: false,
              error: write
                ? "GitHub outcome is uncertain. Inspect the repository before creating another action."
                : "GitHub operation failed",
              ...(write ? { error_code: "completion_persistence_ambiguous" } : {}),
            },
            502,
          );
        } finally {
          await (auth.supabaseAdmin as any).from("github_tool_audit").insert({
            owner_id: auth.userId,
            account_id: repo.data.account_id,
            repository_id: repo.data.id,
            tool: input.tool,
            source_type: "chat",
            success,
            approval_id: null,
            redacted_metadata: {
              repository: repo.data.full_name,
              pending_action_id: action?.id ?? null,
            },
          });
        }
      },
    },
  },
});
