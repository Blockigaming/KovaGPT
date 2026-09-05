import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { runChatSummaryBatch } from "@/lib/chat-summary.server";

export const Route = createFileRoute("/api/internal/chat-summaries")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = runtimeEnv("CHAT_SUMMARY_WORKER_SECRET")?.trim();
        if (!secret)
          return Response.json(
            { error: "chat_summaries_disabled" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        const supplied = /^Bearer\s+(.+)$/iu.exec(
          request.headers.get("authorization")?.trim() ?? "",
        )?.[1];
        if (!supplied || !timingSafeEqualText(supplied, secret))
          return Response.json(
            { error: "unauthorized" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        if (new URL(request.url).search || request.body !== null)
          return Response.json(
            { error: "unexpected_worker_input" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        try {
          return Response.json(await runChatSummaryBatch(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch {
          console.error("[chat-summary] batch failed");
          return Response.json(
            { error: "chat_summary_worker_failed" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
