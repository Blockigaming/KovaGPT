import { createFileRoute } from "@tanstack/react-router";
import { workExecutionDatabase } from "@/lib/work-execution-database.server";
import { requireUser } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { workUuid } from "@/lib/work-execution-protocol.mjs";

export const Route = createFileRoute("/api/work/output")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const json = (body: unknown, status = 200) =>
          Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
        let id;
        try {
          id = workUuid(new URL(request.url).searchParams.get("id"));
        } catch {
          return json({ error: "work_output_id_invalid" }, 400);
        }
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "work_output_download",
          limit: 60,
          windowSeconds: 60,
        });
        if (!rate.allowed)
          return json({ error: "work_output_rate_limited" }, rate.status === "limited" ? 429 : 503);
        const db = workExecutionDatabase(auth.supabaseAdmin);
        const binding = await db
          .from("work_execution_outputs")
          .select("project_file_id,sha256,size_bytes,mime_type")
          .eq("id", id)
          .eq("owner_id", auth.userId)
          .maybeSingle();
        if (binding.error) return json({ error: "work_output_unavailable" }, 503);
        if (!binding.data) return json({ error: "work_output_not_found" }, 404);
        // Caller-scoped RLS must still allow this exact Project file today. User
        // writable Library metadata and previously signed URLs never grant access.
        const file = await auth.supabaseUser
          .from("project_files")
          .select("id,storage_path,status,content_sha256,size_bytes,mime_type")
          .eq("id", binding.data.project_file_id)
          .eq("status", "ready")
          .maybeSingle();
        if (file.error) return json({ error: "work_output_unavailable" }, 503);
        if (
          !file.data ||
          file.data.content_sha256 !== binding.data.sha256 ||
          file.data.size_bytes !== binding.data.size_bytes ||
          file.data.mime_type !== binding.data.mime_type
        )
          return json({ error: "work_output_not_found" }, 404);
        const signed = await auth.supabaseUser.storage
          .from("project-files")
          .createSignedUrl(file.data.storage_path, 60);
        if (signed.error || !signed.data?.signedUrl)
          return json({ error: "work_output_unavailable" }, 503);
        return json({ url: signed.data.signedUrl, expiresIn: 60 });
      },
    },
  },
});
