import { createFileRoute } from "@tanstack/react-router";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { resolveLinkPreview, safePreviewTarget } from "@/lib/link-preview.server.mjs";

const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export const Route = createFileRoute("/api/link-preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          return Response.json({ error: "invalid_content_type" }, { status: 415, headers: noStore });
        }
        try {
          const input = await readBoundedJsonObject(request, 4096, request.signal);
          const target = safePreviewTarget(input.url);
          if (!target) {
            return Response.json({ error: "unsupported_url" }, { status: 400, headers: noStore });
          }
          const preview = await resolveLinkPreview(target.href);
          return preview
            ? Response.json(preview, { headers: noStore })
            : new Response(null, { status: 204, headers: noStore });
        } catch {
          return Response.json({ error: "invalid_request" }, { status: 400, headers: noStore });
        }
      },
    },
  },
});
