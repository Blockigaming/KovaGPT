export const MCP_OAUTH_SCOPES = Object.freeze(["chat", "image_generation", "embeddings", "files"]);
export const MCP_OAUTH_SCOPE_LABELS = Object.freeze({
  chat: "Generate text using prepaid developer credit",
  image_generation: "Generate images using prepaid developer credit",
  embeddings: "Create embeddings using prepaid developer credit",
  files: "Read and manage private developer text files in this developer project",
});
const invalid = (code = "invalid_request") => {
  throw new Error(`mcp_oauth_${code}`);
};
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
export function mcpUuid(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value)
  )
    invalid();
  return value.toLowerCase();
}
export function mcpIssuer(value) {
  if (typeof value !== "string" || value.length > 512) invalid("configuration_unavailable");
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid("configuration_unavailable");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value
  )
    invalid("configuration_unavailable");
  return url.origin;
}
export function mcpScopes(value, allowed = MCP_OAUTH_SCOPES) {
  const values = typeof value === "string" ? value.split(" ") : value;
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > 4 ||
    new Set(values).size !== values.length ||
    values.some((item) => !allowed.includes(item))
  )
    invalid("invalid_scope");
  return [...values].sort();
}
export function mcpRedirect(value, applicationType = "web") {
  if (typeof value !== "string" || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value))
    invalid("invalid_redirect_uri");
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid("invalid_redirect_uri");
  }
  const loopback =
    applicationType === "native" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.port;
  if (
    (!loopback && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== value ||
    url.searchParams.has("code") ||
    url.searchParams.has("error") ||
    url.searchParams.has("state") ||
    url.searchParams.has("iss")
  )
    invalid("invalid_redirect_uri");
  return value;
}
export function mcpClientRegistration(input) {
  if (
    !object(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "client_name",
          "redirect_uris",
          "application_type",
          "grant_types",
          "response_types",
          "token_endpoint_auth_method",
        ].includes(key),
    )
  )
    invalid("invalid_client_metadata");
  const type = input.application_type ?? "web";
  if (
    !["web", "native"].includes(type) ||
    typeof input.client_name !== "string" ||
    input.client_name.trim().length < 1 ||
    input.client_name.length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(input.client_name)
  )
    invalid("invalid_client_metadata");
  if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== "none")
    invalid("invalid_client_metadata");
  if (input.response_types !== undefined && JSON.stringify(input.response_types) !== '["code"]')
    invalid("invalid_client_metadata");
  if (
    input.grant_types !== undefined &&
    (!Array.isArray(input.grant_types) ||
      input.grant_types.length < 1 ||
      input.grant_types.length > 2 ||
      new Set(input.grant_types).size !== input.grant_types.length ||
      input.grant_types.some((grant) => !["authorization_code", "refresh_token"].includes(grant)) ||
      !input.grant_types.includes("authorization_code"))
  )
    invalid("invalid_client_metadata");
  if (
    !Array.isArray(input.redirect_uris) ||
    input.redirect_uris.length < 1 ||
    input.redirect_uris.length > 5
  )
    invalid("invalid_client_metadata");
  const redirects = input.redirect_uris.map((uri) => mcpRedirect(uri, type));
  if (new Set(redirects).size !== redirects.length) invalid("invalid_client_metadata");
  return {
    client_name: input.client_name.trim(),
    redirect_uris: redirects,
    application_type: type,
    grant_types: input.grant_types ?? ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
export function mcpAuthorizationRequest(params, issuer) {
  const allowed = [
    "client_id",
    "redirect_uri",
    "response_type",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    "resource",
  ];
  if (
    !(params instanceof URLSearchParams) ||
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    allowed.some((key) => params.getAll(key).length !== 1)
  )
    invalid();
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256")
    invalid();
  const challenge = params.get("code_challenge"),
    state = params.get("state");
  if (
    !/^[a-zA-Z0-9_-]{43}$/u.test(challenge ?? "") ||
    typeof state !== "string" ||
    state.length < 1 ||
    state.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(state)
  )
    invalid();
  if (params.get("resource") !== `${mcpIssuer(issuer)}/mcp`) invalid("invalid_target");
  return {
    clientId: mcpUuid(params.get("client_id")),
    redirectUri: params.get("redirect_uri"),
    scopes: mcpScopes(params.get("scope")),
    state,
    challenge,
    resource: params.get("resource"),
  };
}
export function mcpVerifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/u.test(value))
    invalid("invalid_grant");
  return value;
}
export function mcpCanonical(value) {
  return JSON.stringify(value, (_, item) =>
    object(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}
export function mcpReviewPayload(request, projectId, scopes, limits) {
  if (!object(limits) || Object.keys(limits).sort().join() !== "concurrent,daily,monthly,request")
    invalid();
  for (const key of ["request", "daily", "monthly"])
    if (
      typeof limits[key] !== "number" ||
      !Number.isFinite(limits[key]) ||
      limits[key] <= 0 ||
      limits[key] > 1000000000 ||
      Math.abs(limits[key] * 1e8 - Math.round(limits[key] * 1e8)) > 0.001
    )
      invalid();
  if (
    limits.daily < limits.request ||
    limits.monthly < limits.daily ||
    !Number.isSafeInteger(limits.concurrent) ||
    limits.concurrent < 1 ||
    limits.concurrent > 8
  )
    invalid();
  return {
    requestId: mcpUuid(request.id),
    requestHash: request.requestHash,
    projectId: mcpUuid(projectId),
    scopes: mcpScopes(scopes, request.scopes),
    limits,
  };
}
