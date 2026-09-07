import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { rejectCrossSiteRequest } from "@/lib/http-security.server";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { pushStatus, subscribePush, pushRpc, setPushQuietHours } from "@/lib/pwa/push.server";
const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", Vary: "Authorization" } });
const owner = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("subscribe"),
      expectedUserId: owner,
      subscription: z
        .object({
          endpoint: z.string().max(2048),
          keys: z.object({ p256dh: z.string().max(100), auth: z.string().max(30) }).strict(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke"),
      expectedUserId: owner,
      id: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("preferences"),
      expectedUserId: owner,
      expectedRevision: z.number().int().nonnegative(),
      quietHours: z
        .object({ start: z.string().max(5), end: z.string().max(5), timeZone: z.string().max(100) })
        .strict()
        .nullable(),
    })
    .strict(),
]);
export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const auth = await requireVerifiedUser(request);
          if (auth instanceof Response) return auth;
          if (new URL(request.url).searchParams.get("expectedUserId") !== auth.userId)
            return reply({ error: "account_changed" }, 409);
          return reply(await pushStatus(auth.userId));
        } catch {
          return reply({ error: "push_status_unavailable" }, 503);
        }
      },
      POST: async ({ request }) => {
        const csrf = rejectCrossSiteRequest(request);
        if (csrf) return csrf;
        try {
          const auth = await requireVerifiedUser(request);
          if (auth instanceof Response) return auth;
          const bytes = await readResponseBytesBounded(request, 4096, {
            signal: request.signal,
            timeoutMs: 3000,
          });
          const value = schema.safeParse(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          );
          if (!value.success) return reply({ error: "push_invalid_request" }, 400);
          const data = value.data;
          if (data.expectedUserId !== auth.userId) return reply({ error: "account_changed" }, 409);
          if (data.action !== "revoke") {
            const rate = await consumeApplicationRateLimit({
              identity: `user:${auth.userId}`,
              action: "push_subscription",
              limit: 20,
              windowSeconds: 3600,
            });
            if (!rate.allowed)
              return reply({ error: "push_try_later" }, rate.status === "unavailable" ? 503 : 429);
          }
          if (data.action === "subscribe")
            return reply(await subscribePush(auth.userId, data.subscription));
          if (data.action === "preferences")
            return reply(
              await setPushQuietHours(auth.userId, data.expectedRevision, data.quietHours),
            );
          return reply(
            await pushRpc(auth.userId, "revoke", {
              id: data.id,
              expectedRevision: data.expectedRevision,
            }),
          );
        } catch {
          return reply({ error: "push_change_unavailable" }, 503);
        }
      },
    },
  },
});
