import { SELF_HOSTED_STARTER_MODELS } from "./self-hosted-starter-policy.mjs";

const REQUEST_KEYS = new Set(["model", "messages", "stream", "max_tokens"]);
const ROLES = new Set(["system", "user", "assistant"]);

/**
 * Operator-only transport factory; never pass browser/request JSON as deployment.
 * The certificate and private DNS must be provisioned before activation.
 * This text-only adapter deliberately rejects tools and images until qualified.
 * No hosted-provider fallback or retry of an ambiguous generation.
 */
export function createSelfHostedStarterTransport(deployment, fetchImpl = fetch) {
  const { model, repository, revision, runtimeDigest, endpoint, token } = deployment;
  if (!Object.hasOwn(SELF_HOSTED_STARTER_MODELS, model)
      || SELF_HOSTED_STARTER_MODELS[model].repository !== repository
      || !/^[a-f0-9]{40}$/.test(revision ?? "")
      || !/^sha256:[a-f0-9]{64}$/.test(runtimeDigest ?? "")
      || typeof token !== "string" || token.length < 32 || /[\r\n]/.test(token))
    throw new Error("invalid_self_hosted_deployment");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".internal")
      || url.username || url.password || url.search || url.hash
      || url.pathname !== "/v1/chat/completions")
    throw new Error("invalid_self_hosted_endpoint");
  const destination = url.href;
  // Snapshot validated configuration so caller mutation cannot change routing.
  const loadedModel = repository + "@" + revision;
  return async function requestSelfHostedStarter(request, { signal, beforeSend } = {}) {
    if (!request || typeof request !== "object" || Array.isArray(request)
        || Object.keys(request).some(key => !REQUEST_KEYS.has(key))
        || request.model !== model || typeof request.stream !== "boolean"
        || !Number.isSafeInteger(request.max_tokens)
        || request.max_tokens < 1 || request.max_tokens > 4800
        || !Array.isArray(request.messages) || !request.messages.length
        || request.messages.length > 256
        || request.messages.some(message => !message || typeof message !== "object"
          || Array.isArray(message)
          || Object.keys(message).some(key => !["role", "content"].includes(key))
          || !ROLES.has(message.role) || typeof message.content !== "string"))
      throw new Error("invalid_self_hosted_request");
    const body = JSON.stringify({ ...request, model: loadedModel,
      ...(request.stream ? { stream_options: { include_usage: true } } : {}) });
    if (Buffer.byteLength(body) > 1024 * 1024)
      throw new Error("self_hosted_request_too_large");
    const bounded = AbortSignal.any([
      AbortSignal.timeout(90_000), ...(signal ? [signal] : []),
    ]);
    bounded.throwIfAborted();
    await beforeSend?.();
    bounded.throwIfAborted();
    const response = await fetchImpl(destination, {
      method: "POST", redirect: "error", signal: bounded,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body,
    });
    const type = response.headers.get("content-type")?.split(";")[0].trim();
    if (!response.ok || response.redirected
        || type !== (request.stream ? "text/event-stream" : "application/json")) {
      try { await response.body?.cancel(); } catch { /* best effort */ }
      throw new Error("self_hosted_inference_unavailable");
    }
    return response;
  };
}
