import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { decryptSecret } from "@/lib/github-oauth.server";
import { GitHubClient } from "@/lib/github-connector.mjs";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";
/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub migration types are generated after deployment. */
const reads = new Set([
    "file",
    "tree",
    "branches",
    "commits",
    "issues",
    "pulls",
    "releases",
    "workflows",
    "workflowRuns",
    "checks",
    "discussions",
    "searchCode",
  ]),
  writes = new Set([
    "createIssue",
    "commentIssue",
    "createBranch",
    "openPull",
    "requestReview",
    "mergePull",
    "proposePatch",
  ]);
export const Route = createFileRoute("/api/github/tool")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let input: any;
        try {
          input = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        if (!reads.has(input.tool) && !writes.has(input.tool))
          return Response.json({ error: "Unknown GitHub tool" }, { status: 400 });
        const write = writes.has(input.tool);
        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          write ? "connector_write" : "connector_read",
        );
        if (lockdown) return lockdown;
        const repo = await (auth.supabaseAdmin as any)
          .from("github_repositories")
          .select("id,full_name,account_id,permissions,default_branch")
          .eq("owner_id", auth.userId)
          .eq("full_name", String(input.repository).toLowerCase())
          .eq("explicitly_granted", true)
          .is("revoked_at", null)
          .single();
        if (repo.error)
          return Response.json({ error: "Repository is not authorized" }, { status: 403 });
        const account = await (auth.supabaseAdmin as any)
          .from("github_accounts")
          .select("token_ciphertext,status")
          .eq("id", repo.data.account_id)
          .eq("owner_id", auth.userId)
          .single();
        if (account.error || account.data.status !== "connected" || !account.data.token_ciphertext)
          return Response.json({ error: "GitHub reconnect required" }, { status: 401 });
        if (write && !input.confirmed)
          return Response.json({ error: "Explicit confirmation required" }, { status: 409 });
        const permissions = repo.data.permissions ?? {};
        if (write && permissions.push !== true && permissions.admin !== true)
          return Response.json({ error: "Repository write permission required" }, { status: 403 });
        const client = new GitHubClient({
          token: await decryptSecret(account.data.token_ciphertext),
          allowedRepositories: [repo.data.full_name],
        });
        let success = false,
          result;
        try {
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
          return Response.json({ result, rateLimit: client.rateLimit });
        } catch {
          return Response.json({ error: "GitHub operation failed" }, { status: 502 });
        } finally {
          await (auth.supabaseAdmin as any).from("github_tool_audit").insert({
            owner_id: auth.userId,
            account_id: repo.data.account_id,
            repository_id: repo.data.id,
            tool: input.tool,
            source_type: input.sourceType === "work" ? "work" : "chat",
            source_id: input.sourceId,
            success,
            approval_id: input.approvalId,
            redacted_metadata: { repository: repo.data.full_name },
          });
        }
      },
    },
  },
});
