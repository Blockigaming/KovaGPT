import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { sweepAccountStorageArtifacts } from "@/lib/account-storage-artifacts.server";

export const Route = createFileRoute("/api/internal/storage-artifact-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        const expected = runtimeEnv("STORAGE_ARTIFACT_CLEANUP_SECRET");
        if (!expected)
          return Response.json(
            { ok: false, error: "storage_cleanup_not_configured" },
            { status: 503, headers },
          );
        const supplied = /^Bearer\s+(.+)$/iu
          .exec(request.headers.get("authorization")?.trim() ?? "")?.[1]
          ?.trim();
        if (!supplied || !timingSafeEqualText(supplied, expected)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
        }
        if (request.body !== null || new URL(request.url).search) {
          void request.body?.cancel().catch(() => undefined);
          return Response.json(
            { ok: false, error: "arguments_not_supported" },
            { status: 400, headers },
          );
        }
        try {
          return Response.json(
            {
              ok: true,
              swept:
                (await sweepAccountStorageArtifacts()) +
                (await (
                  await import("@/lib/library-image-storage.server.mjs")
                ).sweepLibraryImageUploads(
                  (await import("@/integrations/supabase/client.server")).supabaseAdmin,
                  undefined,
                  AbortSignal.timeout(45000),
                )),
            },
            { headers },
          );
        } catch {
          return Response.json(
            { ok: false, error: "storage_cleanup_failed" },
            { status: 503, headers },
          );
        }
      },
    },
  },
});
