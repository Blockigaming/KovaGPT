import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  initializeTaskGmailSource,
  taskEventConfiguration,
  taskEventRpc,
} from "@/lib/scheduled-task-events.server";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
const input = z.object({
  expectedUserId: z.string().uuid(),
  grantId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  action: z.enum(["initialize", "watch", "disable"]),
});
export const Route = createFileRoute("/api/tasks/event-sources")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        if (new URL(request.url).searchParams.get("expectedUserId") !== auth.userId)
          return Response.json({ error: "Your account changed." }, { status: 409 });
        try {
          const grantId = z.string().uuid().parse(new URL(request.url).searchParams.get("grantId"));
          const { configured, config } = taskEventConfiguration();
          const sources = await taskEventRpc("source_list", { userId: auth.userId, grantId });
          return Response.json(
            {
              configured,
              watchConfigured:
                configured.gmail &&
                /^projects\/[a-z][a-z0-9-]{4,62}\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/u.test(
                  config.gmailTopic ?? "",
                ),
              sources,
            },
            { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } },
          );
        } catch {
          return Response.json({ error: "Task event sources are unavailable." }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request))
          return Response.json({ error: "Cross-site request rejected." }, { status: 403 });
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          const data = input.parse(JSON.parse(await readUtf8BodyBounded(request, 2048)));
          if (data.expectedUserId !== auth.userId)
            return Response.json({ error: "Your account changed." }, { status: 409 });
          if (data.action === "disable")
            await taskEventRpc("source_disable", {
              userId: auth.userId,
              grantId: data.grantId,
              expectedRevision: data.expectedRevision,
            });
          else {
            const limited = await enforceGoogleRateLimit(auth.userId, "task_event_source", 10);
            if (limited) return limited;
            await assertLockdownAllows(supabaseAdmin, auth.userId, "connector_write");
            await initializeTaskGmailSource(auth.userId, {
              grantId: data.grantId,
              expectedRevision: data.expectedRevision,
              watch: data.action === "watch",
            });
          }
          return Response.json({ ok: true });
        } catch {
          return Response.json(
            { error: "The event source could not be changed. Refresh its status and try again." },
            { status: 409 },
          );
        }
      },
    },
  },
});
