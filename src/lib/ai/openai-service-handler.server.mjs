import { readBoundedJsonObject } from "../bounded-json.server.mjs";
import { OpenAiServiceError, normalizeBrowserDomains } from "./openai-services.server.mjs";

const operations = new Set([
  "agent",
  "browser",
  "analysis",
  "file_search",
  "decisions",
  "moderation",
]);
const heavy = new Set(["agent", "browser", "analysis"]);
const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
export function parseOpenAiServiceTask(value) {
  if (
    !value ||
    !operations.has(value.operation) ||
    Object.keys(value).some(
      (key) => !["operation", "input", "questions", "documents"].includes(key),
    ) ||
    typeof value.input !== "string" ||
    !value.input.trim() ||
    value.input.length > 16000
  )
    throw new OpenAiServiceError("invalid_service_request", 400);
  if (
    value.operation === "file_search" &&
    (!Array.isArray(value.documents) ||
      !value.documents.length ||
      value.documents.length > 2 ||
      value.documents.some(
        (document) =>
          !document ||
          Object.keys(document).some((key) => !["name", "text"].includes(key)) ||
          typeof document.name !== "string" ||
          !document.name.trim() ||
          document.name.length > 80 ||
          typeof document.text !== "string" ||
          !document.text.trim() ||
          document.text.length > 32000,
      ))
  )
    throw new OpenAiServiceError("invalid_documents", 400);
  if (
    (value.operation !== "decisions" && value.questions !== undefined) ||
    (value.operation !== "file_search" && value.documents !== undefined) ||
    (value.operation === "decisions") !== Array.isArray(value.questions) ||
    (value.operation === "file_search") !== Array.isArray(value.documents)
  )
    throw new OpenAiServiceError("invalid_service_request", 400);
  return value;
}

export function createOpenAiServiceHandler({
  requireVerifiedUser,
  assertNotBanned,
  getCallerTier,
  enforceQuota,
  consumeRateLimit,
  reserveDocuments,
  env,
  services,
}) {
  return async (request) => {
    try {
      if (!["GET", "POST"].includes(request.method))
        return json({ error: "method_not_allowed" }, 405);
      if (
        request.method === "POST" &&
        (request.headers.get("origin") !== new URL(request.url).origin ||
          request.headers.get("sec-fetch-site") === "cross-site")
      )
        return json({ error: "cross_origin_request" }, 403);
      const auth = await requireVerifiedUser(request);
      if (auth instanceof Response) return auth;
      if (request.headers.get("x-kova-service-owner") !== auth.userId)
        return json({ error: "account_changed" }, 409);
      const banned = await assertNotBanned(auth);
      if (banned) return banned;
      const current = async () => {
        if (auth.revalidateSession) return auth.revalidateSession();
        const principal = await requireVerifiedUser(request);
        return !(principal instanceof Response) && principal.userId === auth.userId;
      };
      const enabled =
        env("KOVA_OPENAI_SERVICES_ENABLED") === "true" &&
        env("KOVA_GENERATION_DISABLED") !== "true" &&
        Boolean(env("OPENAI_API_KEY"));
      const tier = await getCallerTier(auth);
      let browserConfigured = false;
      try {
        browserConfigured =
          normalizeBrowserDomains(
            JSON.parse(env("KOVA_OPENAI_BROWSER_ALLOWED_DOMAINS_JSON") || "[]"),
          ).length > 0;
      } catch {
        /* A missing or invalid domain policy disables browser tasks. */
      }
      if (request.method === "GET")
        return json({
          configured: enabled,
          operations: [...operations].map((operation) => ({
            operation,
            available:
              enabled &&
              (operation !== "browser" || browserConfigured) &&
              (!heavy.has(operation) || ["plus", "pro"].includes(tier)),
          })),
        });
      if (!enabled) return json({ error: "openai_services_unavailable" }, 503);
      if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
        return json({ error: "json_required" }, 415);
      const input = parseOpenAiServiceTask(
        await readBoundedJsonObject(request, 160 * 1024, request.signal),
      );
      if (heavy.has(input.operation) && !["plus", "pro"].includes(tier))
        return json({ error: "subscription_required" }, 403);
      if (input.operation === "browser" && !browserConfigured)
        return json({ error: "browser_domains_not_configured" }, 503);
      const id = request.headers.get("idempotency-key");
      if (!id || !/^[A-Za-z0-9:_-]{8,120}$/.test(id))
        return json({ error: "request_identifier_required" }, 400);
      request.signal.throwIfAborted();
      if (!(await current())) return json({ error: "session_expired" }, 401);
      const limits = [
        {
          identity: `openai-service:${auth.userId}:${id}`,
          action: "openai_service_request",
          limit: 1,
          windowSeconds: 86400,
        },
        {
          identity: `user:${auth.userId}`,
          action: "openai_service_minute",
          limit: 2,
          windowSeconds: 60,
        },
        {
          identity: "openai_services_global",
          action: "openai_services_daily",
          limit: 20,
          windowSeconds: 86400,
        },
        ...(heavy.has(input.operation)
          ? [
              {
                identity: `user:${auth.userId}`,
                action: "openai_services_compute_daily",
                limit: 2,
                windowSeconds: 86400,
              },
            ]
          : []),
      ];
      for (const [index, limit] of limits.entries()) {
        const result = await consumeRateLimit(limit);
        if (!result.allowed)
          return json(
            {
              error:
                index === 0 && result.status === "limited"
                  ? "request_already_submitted"
                  : "service_budget_unavailable",
            },
            result.status === "limited" ? (index === 0 ? 409 : 429) : 503,
          );
      }
      if (
        input.operation === "file_search" &&
        !(await reserveDocuments(auth, input.documents, tier, request.signal))
      )
        return json({ error: "upload_limit_reached" }, 429);
      const quota = await enforceQuota(auth, "chats", 50, 1, request.signal);
      if (quota) return quota;
      request.signal.throwIfAborted();
      if (!(await current())) return json({ error: "session_expired" }, 401);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]),
        provider = services();
      let result;
      if (input.operation === "agent") result = await provider.agent(input.input, { signal });
      if (input.operation === "browser") result = await provider.browser(input.input, { signal });
      if (input.operation === "analysis") result = await provider.analyze(input.input, { signal });
      if (input.operation === "file_search")
        result = await provider.searchFiles(input.input, input.documents, { signal });
      if (input.operation === "decisions")
        result = await provider.decisions(input.input, input.questions, { signal });
      if (input.operation === "moderation")
        result = await provider.moderate(input.input, { signal });
      request.signal.throwIfAborted();
      if (!(await current())) return json({ error: "session_expired" }, 401);
      const retired = await assertNotBanned(auth);
      if (retired) return retired;
      return json({ operation: input.operation, ...result });
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      return json(
        {
          error: error instanceof OpenAiServiceError ? error.message : "openai_service_unavailable",
        },
        error instanceof OpenAiServiceError ? error.status : error?.status === 413 ? 413 : 503,
      );
    }
  };
}
