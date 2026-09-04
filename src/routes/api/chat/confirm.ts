// User-triggered execute/cancel for a pending Google write action.
// The chat loop stages actions to `pending_tool_actions`; this endpoint
// is called from the confirmation card the user sees in chat.
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import {
  cancelPendingAction,
  executePendingAction,
  getPendingActionStatus,
} from "@/lib/google-tools.server";
import { enforceGoogleRateLimit } from "@/lib/google-rate-limit.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";

type Body = { action_id?: string; decision?: "confirm" | "cancel" };

export const Route = createFileRoute("/api/chat/confirm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const limited = await enforceGoogleRateLimit(auth.userId, "confirmation_status", 60);
        if (limited) return limited;

        const id = new URL(request.url).searchParams.get("action_id") ?? "";
        if (!id || id.length > 128) {
          return Response.json({ ok: false, error: "Missing action_id" }, { status: 400 });
        }
        const result = await getPendingActionStatus(auth.userId, id);
        if (!result.ok) {
          return Response.json({ ok: false, error: result.error }, { status: 404 });
        }
        return Response.json(result);
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const limited = await enforceGoogleRateLimit(auth.userId, "confirmation", 20);
        if (limited) return limited;
        let body: Body;
        try {
          body = (await readBoundedJsonObject(request, 8 * 1024)) as Body;
        } catch (error) {
          if (error instanceof BoundedJsonError) {
            return Response.json({ ok: false, error: error.code }, { status: error.status });
          }
          return Response.json({ ok: false, error: "invalid_request_body" }, { status: 400 });
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
          return Response.json({
            ok,
            result_text: ok ? "Cancelled." : "Nothing to cancel.",
          });
        }
        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          "connector_write",
        );
        if (lockdown) return lockdown;
        const result = await executePendingAction(auth.userId, id);
        if (result.ok) return Response.json({ ok: true, result_text: result.result_text });
        return Response.json(
          { ok: false, error: result.error, error_code: result.error_code },
          { status: 400 },
        );
      },
    },
  },
});
