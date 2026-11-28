import { developerRateError } from "./developer-http-errors.mjs";
import { Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { checkServerIdentity } from "node:tls";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import {
  authenticateDeveloper,
  developerDatabase,
  developerFailure,
  developerJson,
} from "./developer-platform.server";
import {
  developerWebhookSecret,
  developerWebhookSignature,
  parseDeveloperWebhookRequest,
  publicWebhookIPv4,
  webhookDestination,
} from "./developer-webhook-policy.mjs";

function configuration() {
  if (
    runtimeEnv("KOVA_DEVELOPER_WEBHOOK_SCHEMA_READY") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_WEBHOOKS_ENABLED") !== "true"
  )
    return null;
  const master = runtimeEnv("DEVELOPER_WEBHOOK_MASTER_KEY");
  const allowlist = (runtimeEnv("KOVA_DEVELOPER_WEBHOOK_DESTINATIONS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!master || !/^[a-f0-9]{64}$/i.test(master) || !allowlist.length || allowlist.length > 100)
    return null;
  // Invalid configuration fails closed before any outbound traffic.
  try {
    for (const value of allowlist) webhookDestination(value, allowlist);
  } catch {
    return null;
  }
  return { master, allowlist };
}
export async function handleDeveloperWebhooks(request: Request) {
  try {
    const identity = await authenticateDeveloper(request);
    const config = configuration();
    if (!config) throw new Error("developer_webhook_unavailable");
    const rate = await consumeApplicationRateLimit({
      identity: `developer:${identity.id}`,
      action: "developer_webhooks",
      limit: 20,
      windowSeconds: 60,
    });
    const rateError = developerRateError(rate);
    if (rateError) throw rateError;
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("developer_json_required");
    const parsed = parseDeveloperWebhookRequest(
      request.method,
      new URL(request.url).searchParams,
      request.method === "POST"
        ? await readBoundedJsonObject(request, 8192, request.signal)
        : undefined,
      config.allowlist,
    );
    const result = await identity.db
      .rpc("manage_developer_webhooks_v1", {
        p_owner: identity.ownerId,
        p_key: identity.id,
        p_project: identity.project_id,
        p_operation: parsed.operation,
        p_input: parsed.input,
      })
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    if (result.error || !result.data) {
      const known = result.error?.message?.match(
        /^developer_(?:webhook_not_found|webhook_quota_exceeded|webhook_conflict|webhook_invalid|scope_required)$/,
      )?.[0];
      throw new Error(known ?? "developer_webhook_unavailable");
    }
    if (parsed.operation === "create" || parsed.operation === "rotate") {
      const { secret_nonce: _nonce, ...publicEndpoint } = result.data;
      return developerJson(
        { ...publicEndpoint, signing_secret: developerWebhookSecret(config.master, result.data) },
        parsed.operation === "create" ? 201 : 200,
      );
    }
    return developerJson(result.data, parsed.operation === "test" ? 202 : 200);
  } catch (error) {
    return developerFailure(error);
  }
}

type Claim = {
  endpoint: {
    id: string;
    project_id: string;
    api_key_id: string;
    secret_nonce: string;
    generation: number;
    url: string;
  };
  event: { id: string; type: string; created_at: string; data: Record<string, unknown> };
  lease_token: string;
};

// Resolve only A records, reject nonpublic or mixed answers, then connect to
// the selected address directly with the original hostname as TLS identity.
async function sendClaim(
  claim: Claim,
  config: NonNullable<ReturnType<typeof configuration>>,
  validate: () => Promise<boolean>,
) {
  const url = webhookDestination(claim.endpoint.url, config.allowlist);
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const addresses = await resolver.resolve4(url.hostname);
  if (!addresses.length || addresses.length > 16 || addresses.some((ip) => !publicWebhookIPv4(ip)))
    throw new Error("developer_webhook_destination_unavailable");
  const address = [...addresses].sort()[0];
  if (!(await validate())) throw new Error("developer_webhook_delivery_unavailable");
  const body = JSON.stringify(claim.event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = developerWebhookSignature(
    developerWebhookSecret(config.master, claim.endpoint),
    claim.event.id,
    timestamp,
    body,
  );
  return await new Promise<number>((resolve, reject) => {
    const outbound = httpsRequest(
      {
        hostname: address,
        port: 443,
        servername: url.hostname,
        path: url.pathname,
        method: "POST",
        agent: false,
        rejectUnauthorized: true,
        checkServerIdentity: (_hostname, cert) => checkServerIdentity(url.hostname, cert),
        signal: AbortSignal.timeout(3000),
        headers: {
          Host: url.hostname,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Kova-Webhook-Id": claim.event.id,
          "X-Kova-Webhook-Timestamp": String(timestamp),
          "X-Kova-Webhook-Signature": signature,
        },
      },
      (response) => {
        const status = response.statusCode;
        // Do not follow redirects, parse arbitrary bodies or log destinations.
        response.destroy();
        if (typeof status === "number") resolve(status);
        else reject(new Error("developer_webhook_delivery_unavailable"));
      },
    );
    outbound.once("error", reject);
    outbound.end(body);
  });
}

export async function deliverDeveloperWebhooks() {
  const config = configuration();
  if (!config) return 0;
  const db = developerDatabase();
  const claimed = await db
    .rpc("claim_developer_webhooks_v1", { p_limit: 3 })
    .abortSignal(AbortSignal.timeout(5000));
  if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length > 3)
    throw new Error("developer_webhook_unavailable");
  await Promise.all(
    (claimed.data as Claim[]).map(async (claim) => {
      let status: number | null = null;
      try {
        status = await sendClaim(claim, config, async () => {
          const valid = await db
            .rpc("validate_developer_webhook_claim_v1", {
              p_project: claim.endpoint.project_id,
              p_endpoint: claim.endpoint.id,
              p_event: claim.event.id,
              p_lease: claim.lease_token,
              p_generation: claim.endpoint.generation,
              p_nonce: claim.endpoint.secret_nonce,
              p_url: claim.endpoint.url,
            })
            .abortSignal(AbortSignal.timeout(5000));
          return !valid.error && valid.data === true;
        });
      } catch {
        // A refused destination or transient failure consumes a bounded attempt.
      }
      const result = await db
        .rpc("finish_developer_webhook_v1", {
          p_project: claim.endpoint.project_id,
          p_endpoint: claim.endpoint.id,
          p_event: claim.event.id,
          p_lease: claim.lease_token,
          p_http_status: status,
        })
        .abortSignal(AbortSignal.timeout(5000));
      if (result.error) throw new Error("developer_webhook_delivery_unavailable");
    }),
  );
  return claimed.data.length;
}
