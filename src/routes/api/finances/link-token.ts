import { createFileRoute } from "@tanstack/react-router";
import { requireUser, getCallerTier } from "@/lib/api-auth.server";
import { createFinanceLinkToken } from "@/finances/plaid.server";
export const Route = createFileRoute("/api/finances/link-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        if ((await getCallerTier(auth)) === "free")
          return Response.json({ error: "finance_plan_required" }, { status: 403 });
        const body = (await request.json().catch(() => null)) as { country?: string } | null;
        try {
          return Response.json(await createFinanceLinkToken(auth, body?.country ?? "US"));
        } catch (error) {
          const message = error instanceof Error ? error.message : "finance_unavailable";
          return Response.json(
            { error: message },
            { status: message === "plaid_not_configured" ? 503 : 400 },
          );
        }
      },
    },
  },
});
