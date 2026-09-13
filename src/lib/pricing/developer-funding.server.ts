import type Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { developerUuid, developerRequestKey } from "./developer-platform-policy.mjs";
import { fundingCheckoutParameters, verifiedFundingReceipt } from "./developer-funding-policy.mjs";
import { verifyConfiguredCreditOffer } from "./developer-offer-verification.server";

type Attempt = {
  id: string;
  account_id: string;
  owner_id: string | null;
  lease_token: string;
  revision: number;
  offer_snapshot: { environment: StripeEnv };
  checkout_session_id: string | null;
  checkout_expires_at: string;
  checkout_create_started_at?: string | null;
  checkout_create_parameters?: Record<string, unknown> | null;
  checkout_discovery_cursor?: string | null;
  created_at: string;
  [key: string]: unknown;
};
const options = { timeout: 10000, maxNetworkRetries: 0 };
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
function database() {
  const url = runtimeEnv("SUPABASE_URL"),
    key = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("developer_funding_unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function environment(): StripeEnv {
  const env = runtimeEnv("DEVELOPER_PAYMENTS_ENV");
  if (env !== "sandbox" && env !== "live")
    throw new Error("developer_payments_environment_missing");
  return env;
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await database().rpc(name, args).abortSignal(AbortSignal.timeout(10000));
  if (result.error) throw new Error("developer_funding_storage_unavailable");
  return result.data as T;
}

/** A lease serializes processor reads and ledger writes. Signed webhooks only enqueue durable revisions. */
export async function processDeveloperFunding(attemptId?: string): Promise<boolean> {
  if (!attemptId) await rpc("recover_developer_funding_debt", {});
  let [attempt] = await rpc<Attempt[]>("claim_developer_funding", {
    p_attempt: attemptId ?? null,
  });
  if (!attempt) return false;
  try {
    const env = environment();
    if (attempt.offer_snapshot.environment !== env)
      throw new Error("developer_payment_environment_mismatch");
    const stripe = createStripeClient(env);
    let sessionId = attempt.checkout_session_id;
    if (!sessionId) {
      if (!attempt.checkout_create_started_at) {
        await verifyConfiguredCreditOffer(attempt.offer_snapshot);
        attempt = await rpc<Attempt>("start_developer_checkout", {
          p_attempt: attempt.id,
          p_lease: attempt.lease_token,
          p_parameters: fundingCheckoutParameters(
            attempt,
            runtimeEnv("DEVELOPER_PAYMENTS_ORIGIN") ?? "",
          ),
        });
      }
      if (!attempt.checkout_create_started_at || !attempt.checkout_create_parameters)
        throw new Error("developer_checkout_admission_missing");
      if (Date.now() - Date.parse(attempt.checkout_create_started_at) > 23 * 3600000) {
        const page = await stripe.checkout.sessions.list(
          {
            created: {
              gte: Math.floor(Date.parse(attempt.checkout_create_started_at) / 1000) - 5,
              lte: Math.floor(Date.parse(attempt.checkout_expires_at) / 1000) + 60,
            },
            limit: 100,
            starting_after: attempt.checkout_discovery_cursor ?? undefined,
          },
          options,
        );
        const matches = page.data.filter(
          (item) =>
            item.client_reference_id === attempt.id &&
            item.metadata?.developer_funding_attempt === attempt.id &&
            item.metadata?.developer_account === attempt.account_id,
        );
        if (matches.length > 1 || (page.has_more && !page.data.length))
          throw new Error("developer_processor_session_ambiguous");
        return await rpc<boolean>("record_developer_checkout_discovery", {
          p_attempt: attempt.id,
          p_lease: attempt.lease_token,
          p_cursor: page.has_more ? page.data.at(-1)!.id : null,
          p_found: matches[0]?.id ?? null,
          p_complete: !page.has_more,
        });
      }
      // Readiness was approved at durable first dispatch. An uncertain request
      // replays only that exact accepted payload and idempotency key.
      const params = attempt.checkout_create_parameters;
      const created = await stripe.checkout.sessions.create(
        params as unknown as Stripe.Checkout.SessionCreateParams,
        { ...options, idempotencyKey: `developer-funding:${attempt.id}` },
      );
      sessionId = created.id;
    }
    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["line_items.data.price", "payment_intent.latest_charge.balance_transaction"] },
      options,
    );
    let charge: Stripe.Charge | null = null,
      dispute: Stripe.Dispute | null = null;
    const transactions: Stripe.BalanceTransaction[] = [];
    if (session.payment_status === "paid") {
      const payment = session.payment_intent;
      if (!payment || typeof payment === "string" || !payment.latest_charge)
        throw new Error("developer_payment_intent_unverified");
      charge =
        typeof payment.latest_charge === "string"
          ? await stripe.charges.retrieve(
              payment.latest_charge,
              { expand: ["balance_transaction"] },
              options,
            )
          : payment.latest_charge;
      if (charge.disputed) {
        const disputes = await stripe.disputes.list({ charge: charge.id, limit: 2 }, options);
        if (disputes.has_more || disputes.data.length !== 1)
          throw new Error("developer_payment_dispute_unverified");
        dispute = await stripe.disputes.retrieve(
          disputes.data[0].id,
          { expand: ["balance_transactions"] },
          options,
        );
        for (const tx of dispute.balance_transactions) transactions.push(tx);
      }
      if (charge.amount_refunded > 0) {
        let cursor: string | undefined,
          total = 0;
        for (let page = 0; page < 10; page++) {
          const refunds = await stripe.refunds.list(
            {
              charge: charge.id,
              limit: 100,
              starting_after: cursor,
              expand: ["data.balance_transaction"],
            },
            options,
          );
          for (const refund of refunds.data) {
            if (refund.status !== "succeeded") continue;
            total += refund.amount;
            if (!refund.balance_transaction || typeof refund.balance_transaction === "string")
              throw new Error("developer_payment_refund_fee_unverified");
            transactions.push(refund.balance_transaction);
          }
          if (!refunds.has_more) break;
          if (page === 9 || !refunds.data.length)
            throw new Error("developer_payment_refund_page_bound");
          cursor = refunds.data.at(-1)!.id;
        }
        if (total !== charge.amount_refunded)
          throw new Error("developer_payment_refund_incomplete");
      }
    }
    const verified = verifiedFundingReceipt(attempt, session, charge, dispute, transactions);
    const complete = await rpc<boolean>("complete_developer_funding", {
      p_attempt: attempt.id,
      p_lease: attempt.lease_token,
      p_revision: attempt.revision,
      p_session: { id: session.id, state: verified.state, url: verified.url ?? null },
      p_receipt: verified.receipt,
    });
    if (!complete) throw new Error("developer_funding_lease_changed");
    return true;
  } catch (error) {
    await rpc("defer_developer_funding", {
      p_attempt: attempt.id,
      p_lease: attempt.lease_token,
      p_error:
        error instanceof Error && /^[a-z_]{3,80}$/.test(error.message)
          ? error.message
          : "provider_proof_unavailable",
    });
    return false;
  }
}

export async function handleDeveloperFunding(request: Request) {
  if (request.method !== "GET" && isCrossSiteMutation(request))
    return json({ error: "cross_site_request_blocked" }, 403);
  const caller = await requireVerifiedUser(request);
  if (caller instanceof Response) return caller;
  if (request.headers.get("x-kova-expected-user") !== caller.userId)
    return json({ error: "developer_principal_conflict" }, 409);
  const rate = await consumeApplicationRateLimit({
    identity: `user:${caller.userId}`,
    action: "developer_funding",
    limit: 20,
    windowSeconds: 60,
  });
  if (!rate.allowed) return json({ error: "developer_rate_limit" }, 429);
  try {
    const db = database(),
      enabled = runtimeEnv("KOVA_DEVELOPER_PAYMENTS_ENABLED") === "true";
    if (request.method === "GET") {
      const page = Number(new URL(request.url).searchParams.get("page") ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
        return json({ error: "developer_page_invalid" }, 400);
      const accountId = developerUuid(new URL(request.url).searchParams.get("accountId"));
      const owner = await db
        .from("developer_account_owners")
        .select("account_id")
        .eq("account_id", accountId)
        .eq("owner_id", caller.userId)
        .maybeSingle();
      if (owner.error || !owner.data) return json({ error: "developer_owner_required" }, 403);
      const [offers, attempts] = await Promise.all([
        enabled
          ? db
              .from("developer_credit_offers")
              .select("id,name,currency,subtotal_amount,credits_amount,tax_mode")
              .eq("environment", environment())
              .eq("active", true)
              .gt("expires_at", new Date().toISOString())
              .order("created_at")
              .order("id")
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
        db
          .from("developer_funding_attempts")
          .select("id,state,checkout_url,created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(page * 25, page * 25 + 25),
      ]);
      if (offers.error || attempts.error) throw new Error("developer_funding_unavailable");
      return json({
        enabled,
        offers: offers.data,
        attempts: attempts.data?.slice(0, 25),
        page,
        hasMore: (attempts.data?.length ?? 0) > 25,
      });
    }
    if (!enabled) return json({ error: "developer_payments_disabled" }, 503);
    const body = await readBoundedJsonObject(request, 4096);
    const item = await rpc<Attempt>("begin_developer_funding", {
      p_owner: caller.userId,
      p_account: developerUuid(body.accountId),
      p_offer: developerUuid(body.offerId),
      p_request_key: developerRequestKey(request.headers.get("idempotency-key")),
      p_environment: environment(),
    });
    await processDeveloperFunding(item.id);
    const stored = await db
      .from("developer_funding_attempts")
      .select("id,state,checkout_url")
      .eq("id", item.id)
      .eq("owner_id", caller.userId)
      .maybeSingle();
    if (stored.error || !stored.data) throw new Error("developer_funding_unavailable");
    return json(stored.data, stored.data.checkout_url ? 200 : 202);
  } catch {
    return json(
      {
        error: "developer_funding_unavailable",
        message: "Your payment remains protected. Retry the same request or check its status.",
      },
      503,
    );
  }
}

export async function handleDeveloperFundingWebhook(request: Request) {
  try {
    const env = environment(),
      stripe = createStripeClient(env),
      secret = runtimeEnv("DEVELOPER_PAYMENTS_WEBHOOK_SECRET");
    if (!secret) return json({ error: "developer_payment_webhook_unconfigured" }, 503);
    const signature = request.headers.get("stripe-signature");
    if (!signature) return json({ error: "developer_payment_signature_required" }, 400);
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        await readUtf8BodyBounded(request, 2097152),
        signature,
        secret,
      );
    } catch {
      return json({ error: "developer_payment_signature_invalid" }, 400);
    }
    if (event.livemode !== (env === "live"))
      return json({ error: "developer_payment_environment_mismatch" }, 400);
    const object = event.data.object as { id: string; charge?: string };
    let attemptId: string | undefined, sessionId: string | undefined;
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
      ].includes(event.type)
    ) {
      const session = await stripe.checkout.sessions.retrieve(object.id, {}, options);
      attemptId = session.metadata?.developer_funding_attempt;
      sessionId = session.id;
    } else if (
      [
        "charge.refunded",
        "charge.dispute.created",
        "charge.dispute.updated",
        "charge.dispute.closed",
        "charge.dispute.funds_withdrawn",
        "charge.dispute.funds_reinstated",
      ].includes(event.type)
    ) {
      const charge = await stripe.charges.retrieve(
        event.type === "charge.refunded" ? object.id : object.charge!,
        {},
        options,
      );
      if (typeof charge.payment_intent !== "string") return json({ received: true });
      const payment = await stripe.paymentIntents.retrieve(charge.payment_intent, {}, options);
      attemptId = payment.metadata.developer_funding_attempt;
      if (attemptId) {
        const sessions = await stripe.checkout.sessions.list(
          { payment_intent: payment.id, limit: 2 },
          options,
        );
        if (sessions.has_more || sessions.data.length !== 1)
          throw new Error("developer_payment_session_unverified");
        sessionId = sessions.data[0].id;
      }
    } else return json({ received: true });
    if (!attemptId) return json({ received: true });
    await rpc("queue_developer_funding", {
      p_attempt: developerUuid(attemptId),
      p_environment: env,
      p_event: event.id,
      p_session: sessionId ?? null,
    });
    // Durable admission is enough for the webhook acknowledgement. Processor
    // reconciliation runs under its lease in the authenticated maintenance worker.
    return json({ received: true });
  } catch {
    return json({ error: "developer_payment_webhook_retry" }, 503);
  }
}
