import { createFileRoute } from "@tanstack/react-router";
import { requireUser, getCallerTier } from "@/lib/api-auth.server";
import { createFinanceLinkToken } from "@/finances/plaid.server";
import { publicFinanceError } from "@/finances/public-errors.server";

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
          const safe = publicFinanceError(error, "finance_unavailable");
          console.error("[finance link-token]", safe.logCode);
          return Response.json(
            { error: safe.error },
            { status: safe.status, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
