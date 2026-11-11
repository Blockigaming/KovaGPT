import { createFileRoute } from "@tanstack/react-router";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { normalizeLinkPreviewUrl } from "@/lib/link-preview.mjs";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export const Route = createFileRoute("/api/link-preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const length = Number(request.headers.get("content-length") ?? "0");
        if (
          !Number.isFinite(length) ||
          length > 4096 ||
          !request.headers.get("content-type")?.startsWith("application/json")
        ) {
          return json({ error: "Invalid link preview request." }, 400);
        }

        let url: string | null;
        try {
          const raw = await request.text();
          if (raw.length > 4096) return json({ error: "Request too large." }, 413);
          const payload: unknown = JSON.parse(raw);
          const input =
            payload && typeof payload === "object" && !Array.isArray(payload)
              ? (payload as { url?: unknown }).url
              : null;
          url = normalizeLinkPreviewUrl(input);
        } catch {
          return json({ error: "Invalid link preview request." }, 400);
        }
        if (!url) return json({ error: "Unsupported link." }, 400);

        const limit = await consumeApplicationRateLimit({
          identity: resolveAnonymousClientKey(request.headers),
          action: "link_preview",
          limit: 120,
          windowSeconds: 3600,
        });
        if (!limit.allowed) {
          return json(
            { error: "Link preview temporarily unavailable." },
            limit.status === "limited" ? 429 : 503,
          );
        }

        try {
          // The resolver is server-only and uses public-network egress, not direct fetch().
          const { resolveLinkPreview } = await import("@/lib/link-preview.server.mjs");
          const result = await resolveLinkPreview(url, request.signal);
          return result ? json(result) : json({ error: "Unsupported link." }, 400);
        } catch {
          return json({ error: "Link preview temporarily unavailable." }, 503);
        }
      },
    },
  },
});
