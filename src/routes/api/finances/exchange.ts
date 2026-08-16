import { createFileRoute } from "@tanstack/react-router";
import { requireUser, getCallerTier } from "@/lib/api-auth.server";
import { exchangeFinanceToken } from "@/finances/plaid.server";
import { publicFinanceError } from "@/finances/public-errors.server";

export const Route = createFileRoute("/api/finances/exchange")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        if ((await getCallerTier(auth)) === "free")
          return Response.json({ error: "finance_plan_required" }, { status: 403 });
        const body = (await request.json().catch(() => null)) as {
          publicToken?: string;
          country?: string;
        } | null;
        if (!body?.publicToken)
          return Response.json({ error: "public_token_required" }, { status: 400 });
        try {
          return Response.json(
            await exchangeFinanceToken(auth, body.publicToken, body.country ?? "US"),
            { status: 201 },
          );
        } catch (error) {
          const safe = publicFinanceError(error, "finance_exchange_failed");
          console.error("[finance exchange]", safe.logCode);
          return Response.json(
            { error: safe.error },
            { status: safe.status, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
