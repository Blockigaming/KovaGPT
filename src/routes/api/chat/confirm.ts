// User-triggered execute/cancel for a pending Google write action.
// The chat loop stages actions to `pending_tool_actions`; this endpoint
// is called from the confirmation card the user sees in chat.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { cancelPendingAction, executePendingAction } from "@/lib/google-tools.server";

type Body = { action_id?: string; decision?: "confirm" | "cancel" };

export const Route = createFileRoute("/api/chat/confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const id = String(body.action_id ?? "");
        const decision = body.decision;
        if (!id || (decision !== "confirm" && decision !== "cancel")) {
          return Response.json(
            { ok: false, error: "Missing action_id or decision" },
            { status: 400 },
          );
        }
        if (decision === "cancel") {
          const ok = await cancelPendingAction(auth.userId, id);
          return Response.json({ ok, result_text: ok ? "Cancelled." : "Nothing to cancel." });
        }
        const result = await executePendingAction(auth.userId, id);
        if (result.ok) return Response.json({ ok: true, result_text: result.result_text });
        return Response.json({ ok: false, error: result.error }, { status: 400 });
      },
    },
  },
});
