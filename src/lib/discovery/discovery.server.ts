import { requireVerifiedUser } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { readAccountDeletionState } from "@/lib/account-deletion-state.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { discoveryConfiguration } from "./discovery-policy.mjs";
import { runDiscovery } from "./discovery-provider.mjs";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function handleDiscovery(request: Request) {
  try {
    if (isCrossSiteMutation(request)) return json({ error: "discovery_origin_invalid" }, 403);
    const auth = await requireVerifiedUser(request);
    if (auth instanceof Response) return auth;
    if (request.headers.get("x-kova-expected-user") !== auth.userId)
      return json({ error: "discovery_principal_conflict" }, 409);
    const rate = await consumeApplicationRateLimit({
      identity: `user:${auth.userId}`,
      action: "discovery_ingress",
      limit: 30,
      windowSeconds: 60,
    });
    if (!rate.allowed)
      return json({ error: "discovery_rate_limit" }, rate.status === "limited" ? 429 : 503);
    const config = discoveryConfiguration(
      Object.fromEntries(
        [
          "KOVA_DISCOVERY_ENABLED",
          "KOVA_GENERATION_DISABLED",
          "KOVA_DISCOVERY_GLOBAL_DAILY_REQUESTS",
          "KOVA_DISCOVERY_USER_DAILY_REQUESTS",
          "KOVA_DISCOVERY_SOURCE_SECRET",
          "FIRECRAWL_API_KEY",
        ].map((key) => [key, runtimeEnv(key)]),
      ),
    );
    if ((await readAccountDeletionState(auth.supabaseAdmin, auth.userId)).state !== "active")
      return json({ error: "discovery_owner_unavailable" }, 403);
    await assertLockdownAllows(auth.supabaseAdmin, auth.userId, "live_web");
    if (request.method === "GET") return json({ enabled: config.enabled });
    if (request.method !== "POST") return json({ error: "discovery_method_invalid" }, 405);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
      return json({ error: "discovery_json_required" }, 415);
    const input = await readBoundedJsonObject(request, 8192, request.signal);
    return json(
      await runDiscovery({
        owner: auth.userId,
        input,
        config,
        signal: request.signal,
        admit: async () => {
          const result = await auth.supabaseAdmin
            .rpc(
              "admit_discovery_request" as never,
              {
                p_owner: auth.userId,
                p_user_limit: config.userDailyLimit,
                p_global_limit: config.globalDailyLimit,
              } as never,
            )
            .abortSignal(AbortSignal.timeout(10000));
          if (result.error) throw new Error("discovery_admission_unavailable");
          return result.data === true;
        },
      }),
    );
  } catch (error) {
    if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
    const code = error instanceof Error ? error.message : "";
    const safe = /^(?:discovery|lockdown)_[a-z_]+$/.test(code) ? code : "discovery_unavailable";
    return json(
      { error: safe },
      /daily_limit/.test(safe)
        ? 429
        : /invalid/.test(safe)
          ? 400
          : /source_expired/.test(safe)
            ? 409
            : /lockdown/.test(safe)
              ? 403
              : 503,
    );
  }
}
