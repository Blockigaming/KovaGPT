/**
 * Staging-only OpenAI-compatible inference transport.
 * This is deliberately NOT wired to production provider selection.
 * Call only from an authenticated, server-side Kova route after authorization.
 */
const ALLOWED_PATHS = new Set(["/v1/models", "/v1/chat/completions"]);
const MODEL_IDS = new Set(["kova-xenon-5", "kova-neon-4.6", "kova-argon-4.6"]);

export function validateInferenceEndpoint(endpoint) {
  if (typeof endpoint !== "string") throw new Error("inference_endpoint_required");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !url.hostname
  ) {
    throw new Error("invalid_inference_endpoint");
  }
  // Reject direct loopback, private-address, and link-local endpoints.
  // In production also enforce an operator-managed hostname allowlist.
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^(10|127|169\.254|192\.168)\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("private_inference_endpoint");
  }
  return url.origin;
}

export function validateInferenceRequest({ path, modelId, body }) {
  if (!ALLOWED_PATHS.has(path)) throw new Error("unsupported_inference_path");
  if (path === "/v1/chat/completions" && !MODEL_IDS.has(modelId))
    throw new Error("unknown_kova_model");
  if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body)))
    throw new Error("invalid_inference_body");
  return true;
}

export async function requestStagingInference({
  endpoint,
  token,
  path = "/v1/chat/completions",
  modelId,
  body = {},
  signal,
  fetchImpl = fetch,
}) {
  const origin = validateInferenceEndpoint(endpoint);
  validateInferenceRequest({ path, modelId, body });
  if (typeof token !== "string" || token.length < 16) throw new Error("inference_token_required");
  const requestBody = path === "/v1/chat/completions" ? { ...body, model: modelId } : undefined;
  const response = await fetchImpl(origin + path, {
    method: path === "/v1/models" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(requestBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error("staging_inference_unavailable");
  return response;
}
