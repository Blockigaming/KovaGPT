import { createFileRoute } from "@tanstack/react-router";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { kovaId } from "@/lib/custom-kovas-policy.mjs";
import { kovaRpc, kovaError } from "@/lib/custom-kovas.server";
export const Route = createFileRoute("/api/kovas/directory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const rate = await consumeApplicationRateLimit({
          identity: resolveAnonymousClientKey(request.headers),
          action: "custom_kova_directory",
          limit: 120,
          windowSeconds: 60,
        });
        if (!rate.allowed)
          return Response.json({ error: "custom_kova_rate_limited" }, { status: 429 });
        try {
          const url = new URL(request.url);
          if ([...url.searchParams.keys()].some((v) => v !== "after"))
            throw Object.assign(Error("invalid"), { status: 400 });
          return Response.json(
            await kovaRpc(
              supabaseAdmin,
              "read_custom_kovas",
              {
                p_actor: null,
                p_scope: "directory",
                p_id: null,
                p_after: url.searchParams.get("after")
                  ? kovaId(url.searchParams.get("after"))
                  : null,
              },
              request.signal,
            ),
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          return kovaError(e);
        }
      },
    },
  },
});
