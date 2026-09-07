import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomBytes } from "node:crypto";
import { requireUser } from "@/lib/api-auth.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { isCrossSiteMutation, parseBearerToken } from "@/lib/auth-security.mjs";
import {
  parseTrustedContactCommand,
  needsTrustedContactActivation,
  TRUSTED_CONTACT_POLICY_VERSION,
} from "@/lib/trusted-contact-policy.mjs";

type Result = { data: unknown; error?: unknown };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  in(key: string, value: string[]): Query;
  eq(key: string, value: unknown): Query;
  order(key: string, options?: unknown): Query;
  limit(count: number): Query;
  range(from: number, to: number): Query;
  abortSignal(signal: AbortSignal): PromiseLike<Result>;
};
type Client = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): Query;
};
const respond = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
const enabled = () =>
  runtimeEnv("KOVA_TRUSTED_CONTACTS_ENABLED") === "true" &&
  runtimeEnv("KOVA_TRUSTED_CONTACTS_POLICY_VERSION") === TRUSTED_CONTACT_POLICY_VERSION;
async function limited(userId: string, action: string, limit: number, windowSeconds: number) {
  return consumeApplicationRateLimit({ identity: userId, action, limit, windowSeconds });
}
async function rpc(
  client: unknown,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  return (client as Client)
    .rpc(name, args)
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(8000)]));
}
export const Route = createFileRoute("/api/trusted-contacts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caller = await requireUser(request);
        if (caller instanceof Response) return caller;
        const blockPage = Number(new URL(request.url).searchParams.get("blockPage") ?? 0);
        if (!Number.isSafeInteger(blockPage) || blockPage < 0 || blockPage > 10000)
          return respond({ error: "Invalid page." }, 400);
        const budget = await limited(caller.userId, "trusted_contact_read", 30, 60);
        if (!budget.allowed)
          return respond(
            { error: "Contacts could not be loaded. Try again shortly." },
            budget.status === "limited" ? 429 : 503,
          );
        const client = caller.supabaseUser as unknown as Client;
        try {
          const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
          const [active, history, blocked] = await Promise.all([
            client
              .from("trusted_contact_details")
              .select("*")
              .in("state", ["pending", "accepted"])
              .order("created_at", { ascending: false })
              .order("id")
              .limit(30)
              .abortSignal(signal),
            client
              .from("trusted_contact_details")
              .select("*")
              .in("state", ["declined", "revoked", "expired"])
              .order("updated_at", { ascending: false })
              .order("id")
              .limit(50)
              .abortSignal(signal),
            client
              .from("trusted_contact_blocks")
              .select("id,blocked_user_id,blocked_email,revision,created_at")
              .eq("user_id", caller.userId)
              .order("created_at", { ascending: false })
              .order("blocked_user_id")
              .range(blockPage * 100, blockPage * 100 + 100)
              .abortSignal(signal),
          ]);
          if (
            active.error ||
            history.error ||
            blocked.error ||
            ![active.data, history.data, blocked.data].every(Array.isArray)
          )
            throw new Error();
          return respond({
            enabled: enabled(),
            policyVersion: TRUSTED_CONTACT_POLICY_VERSION,
            active: active.data,
            history: history.data,
            blocked: (blocked.data as unknown[]).slice(0, 100),
            blockPage,
            moreBlocked: (blocked.data as unknown[]).length > 100,
            notificationDelivery: "in_app_only",
          });
        } catch {
          return respond({ error: "Contacts could not be loaded. Please retry." }, 503);
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request))
          return respond({ error: "Cross-site changes are not allowed." }, 403);
        const caller = await requireUser(request);
        if (caller instanceof Response) return caller;
        let command;
        try {
          command = parseTrustedContactCommand(
            JSON.parse(await readUtf8BodyBounded(request, 4096)),
          );
        } catch {
          return respond(
            { error: "Review the contact details and consent before continuing." },
            400,
          );
        }
        if (needsTrustedContactActivation(command.action) && !enabled())
          return respond(
            {
              error:
                "New trusted-contact connections are not activated. Existing contacts can still be declined, revoked, blocked, or removed.",
            },
            503,
          );
        const budget = await limited(
          caller.userId,
          command.action === "invite" ? "trusted_contact_invite" : "trusted_contact_change",
          command.action === "invite" ? 5 : 30,
          command.action === "invite" ? 86400 : 60,
        );
        if (!budget.allowed)
          return respond(
            { error: "This contact action is temporarily unavailable. Try again later." },
            budget.status === "limited" ? 429 : 503,
          );
        try {
          if (command.action === "invite") {
            // Resolve the verified current sender from Auth, never a caller-supplied label.
            const token = parseBearerToken(request.headers.get("authorization") ?? "");
            const { data, error } = await caller.supabaseUser.auth.getUser(token ?? undefined);
            if (
              error ||
              data.user?.id !== caller.userId ||
              !data.user.email ||
              !data.user.email_confirmed_at
            )
              throw new Error();
            const result = await rpc(
              caller.supabaseAdmin,
              "create_trusted_contact_invitation",
              {
                p_actor: caller.userId,
                p_actor_email: data.user.email,
                p_recipient_email: command.recipientEmail,
                p_id: command.id,
                p_consent: true,
                p_policy: command.policyVersion,
              },
              request.signal,
            );
            if (result.error) throw new Error();
            return respond({ result: result.data, notificationDelivery: "in_app_only" });
          }
          if (command.action === "unblock") {
            const result = await rpc(
              caller.supabaseAdmin,
              "unblock_trusted_contact",
              {
                p_actor: caller.userId,
                p_other: command.otherId,
                p_revision: command.revision,
                p_block_id: command.blockId,
              },
              request.signal,
            );
            if (result.error || result.data !== true) throw new Error();
            return respond({ ok: true });
          }
          const token =
            command.action === "review"
              ? randomBytes(32).toString("hex")
              : command.action === "accept"
                ? command.token
                : null;
          const result = await rpc(
            caller.supabaseAdmin,
            "command_trusted_contact",
            {
              p_actor: caller.userId,
              p_id: command.id,
              p_revision: command.revision,
              p_action: command.action,
              p_command: command.commandId,
              p_token_digest: token ? createHash("sha256").update(token).digest("hex") : null,
              p_consent: command.action === "accept",
            },
            request.signal,
          );
          if (result.error) throw new Error();
          return respond({
            result: result.data,
            ...(command.action === "review" ? { token } : {}),
          });
        } catch {
          return respond(
            {
              error:
                "This contact action could not be completed. Refresh to check the current state.",
            },
            409,
          );
        }
      },
    },
  },
});
