import { createFileRoute } from "@tanstack/react-router";
import { requireUser, getCallerTier } from "@/lib/api-auth.server";
import {
  listFinanceConnections,
  readFinanceConnection,
  disconnectFinanceConnection,
} from "@/finances/plaid.server";
import { publicFinanceError } from "@/finances/public-errors.server";
import { readUtf8BodyBounded, BodyReadError } from "@/lib/endpoint-reliability.mjs";

const headers = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/finances/manage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          return Response.json(
            {
              ...(await listFinanceConnections(auth)),
              planEligible: (await getCallerTier(auth)) !== "free",
            },
            { headers },
          );
        } catch {
          return Response.json({ error: "finance_status_unavailable" }, { status: 503, headers });
        }
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        try {
          const body = JSON.parse(await readUtf8BodyBounded(request, 4096)) as {
            action?: string;
            connectionId?: string;
          };
          if (
            !body ||
            !["read", "disconnect"].includes(body.action ?? "") ||
            typeof body.connectionId !== "string" ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
              body.connectionId,
            )
          )
            return Response.json({ error: "invalid_finance_action" }, { status: 400, headers });
          // Paid access gates reads, never offboarding after a downgrade.
          if (body.action === "read" && (await getCallerTier(auth)) === "free")
            return Response.json({ error: "finance_plan_required" }, { status: 403, headers });
          const result =
            body.action === "read"
              ? await readFinanceConnection(auth, body.connectionId)
              : await disconnectFinanceConnection(auth, body.connectionId);
          return Response.json(result, { headers });
        } catch (error) {
          if (error instanceof BodyReadError)
            return Response.json(
              { error: "invalid_finance_action" },
              { status: error.status, headers },
            );
          if (error instanceof SyntaxError)
            return Response.json({ error: "invalid_finance_action" }, { status: 400, headers });
          const safe = publicFinanceError(error, "finance_unavailable");
          return Response.json({ error: safe.error }, { status: safe.status, headers });
        }
      },
    },
  },
});
