import Stripe from "stripe";
import { timingSafeEqualText } from "@/lib/http-security.server";
import { stripeEventMatchesEnvironment } from "@/lib/stripe-event-mode.mjs";
import { readUtf8BodyBounded } from "@/lib/endpoint-reliability.mjs";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

// New and legacy webhook writers cannot safely operate at the same time.
// An operator enables this only after the source migration/drain checklist.
export function durableStripeBillingEnabled(): boolean {
  return process.env.STRIPE_BILLING_RUNTIME === "durable";
}

const stripeClients = new Map<StripeEnv, { apiKey: string; client: Stripe }>();

export type VerifiedStripeEvent = {
  id: string;
  created: number;
  livemode: boolean;
  type: string;
  data: { object: unknown };
};

export class StripeWebhookVerificationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "StripeWebhookVerificationError";
  }
}

function rejectWebhook(message: string): never {
  throw new StripeWebhookVerificationError(message);
}

export function getConnectionApiKey(env: StripeEnv): string {
  return env === "sandbox" ? getEnv("STRIPE_SANDBOX_API_KEY") : getEnv("STRIPE_LIVE_API_KEY");
}

export function createStripeClient(env: StripeEnv): Stripe {
  const connectionApiKey = getConnectionApiKey(env);
  const cached = stripeClients.get(env);
  if (cached?.apiKey === connectionApiKey) return cached.client;

  const client = new Stripe(connectionApiKey, {
    apiVersion: "2026-08-26.dahlia",
  });
  stripeClients.set(env, { apiKey: connectionApiKey, client });
  return client;
}

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as {
      message?: string;
      raw?: { message?: string };
    };
    return e.raw?.message ?? e.message ?? "Stripe request failed";
  }
  return "Stripe request failed";
}

function parseVerifiedStripeEvent(body: string, env: StripeEnv): VerifiedStripeEvent {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    rejectWebhook("Invalid webhook payload");
  }
  if (!value || typeof value !== "object") rejectWebhook("Invalid webhook payload");

  const event = value as {
    id?: unknown;
    created?: unknown;
    livemode?: unknown;
    type?: unknown;
    data?: unknown;
  };
  if (typeof event.id !== "string" || !event.id.trim()) {
    rejectWebhook("Invalid webhook event id");
  }
  if (
    typeof event.created !== "number" ||
    !Number.isSafeInteger(event.created) ||
    event.created < 0
  ) {
    rejectWebhook("Invalid webhook event timestamp");
  }
  if (typeof event.type !== "string" || !event.type.trim()) {
    rejectWebhook("Invalid webhook event type");
  }
  if (!event.data || typeof event.data !== "object" || !("object" in event.data)) {
    rejectWebhook("Invalid webhook event data");
  }
  if (typeof event.livemode !== "boolean" || !stripeEventMatchesEnvironment(event.livemode, env)) {
    rejectWebhook("Webhook environment mismatch");
  }

  return {
    id: event.id,
    created: event.created,
    livemode: event.livemode,
    type: event.type,
    data: { object: (event.data as { object: unknown }).object },
  };
}

export async function verifyWebhook(req: Request, env: StripeEnv): Promise<VerifiedStripeEvent> {
  const signature = req.headers.get("stripe-signature");
  const maxBodyBytes = 2 * 1024 * 1024;
  let body: string;
  try {
    body = await readUtf8BodyBounded(req, maxBodyBytes);
  } catch {
    rejectWebhook("Invalid webhook body");
  }
  const secret =
    env === "sandbox"
      ? getEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET")
      : getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");

  if (!signature || !body) rejectWebhook("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1" && value) v1Signatures.push(value);
  }
  if (!timestamp || !/^\d+$/u.test(timestamp) || v1Signatures.length === 0) {
    rejectWebhook("Invalid signature format");
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) rejectWebhook("Invalid signature timestamp");
  const age = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (age > 300) rejectWebhook("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = Buffer.from(new Uint8Array(signed)).toString("hex");

  if (!v1Signatures.some((candidate) => timingSafeEqualText(candidate, expected))) {
    rejectWebhook("Invalid webhook signature");
  }

  return parseVerifiedStripeEvent(body, env);
}
