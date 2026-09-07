import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { workRunnerConfiguration } from "@/lib/work-runner.server";
import { verifyRunnerInvocation } from "@/lib/work-runner-transport.mjs";
import { workExecutionDatabase } from "@/lib/work-execution-database.server";
import {
  executeConfiguredWorkRun,
  recoverConfiguredWorkRun,
} from "@/lib/work-execution-driver.server";

export const Route = createFileRoute("/api/internal/work-execution")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
        let configuration;
        try {
          configuration = workRunnerConfiguration();
        } catch {
          return json({ error: "work_runner_unavailable" }, 503);
        }
        if (!configuration) return json({ error: "work_runner_unavailable" }, 503);
        const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!token || !timingSafeEqualText(token, configuration.token))
          return json({ error: "unauthorized" }, 401);
        if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
          return json({ error: "json_content_type_required" }, 415);
        let invocation;
        try {
          invocation = await verifyRunnerInvocation(
            configuration,
            await readUtf8BodyBounded(request, 4096),
            request.headers.get("x-kova-signature"),
          );
        } catch {
          return json({ error: "work_runner_invocation_invalid" }, 401);
        }
        const rate = await consumeApplicationRateLimit({
          identity: `runner:${configuration.id}`,
          action: "work_runner_dispatch",
          limit: 120,
          windowSeconds: 60,
        });
        if (!rate.allowed)
          return json({ error: "work_runner_rate_limited" }, rate.status === "limited" ? 429 : 503);
        try {
          const db = workExecutionDatabase(supabaseAdmin);
          if (invocation.operation === "probe") {
            const probe = await db.from("work_execution_runs").select("id").limit(0);
            return probe.error
              ? json({ error: "work_schema_unavailable" }, 503)
              : json({ status: "ready" });
          }
          const record =
            invocation.operation === "drain"
              ? await db.rpc("next_work_execution_dispatch", {
                  p_runner_id: configuration.id,
                  p_build: configuration.build,
                })
              : await db
                  .from("work_execution_runs")
                  .select("owner_id,state")
                  .eq("id", invocation.runId!)
                  .maybeSingle();
          if (!record.error && !record.data && invocation.operation === "drain")
            return json({ status: "idle" });
          if (
            record.error ||
            !record.data ||
            record.data.state.runnerId !== configuration.id ||
            record.data.state.runnerBuild !== configuration.build
          )
            return json({ error: "work_run_unavailable" }, 404);
          const owner = await supabaseAdmin.auth.admin.getUserById(record.data.owner_id);
          const user = owner.data?.user as {
            id: string;
            email_confirmed_at?: string;
            banned_until?: string;
            deleted_at?: string;
          } | null;
          if (
            owner.error ||
            !user ||
            !user.email_confirmed_at ||
            user.deleted_at ||
            (user.banned_until && Date.parse(user.banned_until) > Date.now())
          )
            return json({ error: "work_owner_unavailable" }, 403);
          const url = runtimeEnv("SUPABASE_URL"),
            publishable = runtimeEnv("SUPABASE_PUBLISHABLE_KEY");
          if (!url || !publishable) return json({ error: "work_auth_unavailable" }, 503);
          // The service actor derives the owner only from the durable run. Its optional
          // user client is anonymous, so an accidental caller-scoped access fails closed;
          // no user JWT is fabricated and no service key is masqueraded as a user token.
          const caller = {
            userId: user.id,
            emailVerified: true,
            supabaseAdmin,
            supabaseUser: createClient<Database>(url, publishable, {
              auth: { persistSession: false, autoRefreshToken: false },
            }),
          };
          const state =
            invocation.operation === "recover" || record.data.state.status !== "queued"
              ? await recoverConfiguredWorkRun(caller, record.data.state.id)
              : await executeConfiguredWorkRun(caller, record.data.state.id);
          return json({ runId: state.id, status: state.status, revision: state.revision });
        } catch {
          return json({ error: "work_dispatch_unconfirmed" }, 503);
        }
      },
    },
  },
});
