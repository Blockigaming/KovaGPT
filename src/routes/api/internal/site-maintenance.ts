import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
export const Route = createFileRoute("/api/internal/site-maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" },
          secret = runtimeEnv("SITES_MAINTENANCE_SECRET");
        if (!secret)
          return Response.json(
            { error: "site_maintenance_not_configured" },
            { status: 503, headers },
          );
        const supplied = /^Bearer\s+(.+)$/iu
          .exec(request.headers.get("authorization")?.trim() ?? "")?.[1]
          ?.trim();
        if (!supplied || !timingSafeEqualText(supplied, secret))
          return Response.json({ error: "unauthorized" }, { status: 401, headers });
        if (request.body !== null || new URL(request.url).search) {
          void request.body?.cancel().catch(() => {});
          return Response.json({ error: "arguments_not_supported" }, { status: 400, headers });
        }
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 10000);
        try {
          const { data, error } = await supabaseAdmin
            .rpc("cleanup_kova_site_versions" as never, { p_owner: null, p_limit: 5 } as never)
            .abortSignal(controller.signal);
          if (error || typeof data !== "number") throw Error();
          return Response.json({ ok: true, retiredVersions: data }, { headers });
        } catch {
          return Response.json({ error: "site_maintenance_unavailable" }, { status: 503, headers });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
