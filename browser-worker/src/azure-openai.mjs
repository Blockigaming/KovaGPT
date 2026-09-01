const AZURE_OPENAI_RESOURCE = "https://cognitiveservices.azure.com";

function required(value, code) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(code);
  return normalized;
}

function endpointBase(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("browser_azure_openai_endpoint_invalid");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("browser_azure_openai_endpoint_invalid");
  }
  if (
    !endpoint.hostname.endsWith(".openai.azure.com") &&
    !endpoint.hostname.endsWith(".services.ai.azure.com") &&
    !endpoint.hostname.endsWith(".cognitiveservices.azure.com")
  ) {
    throw new Error("browser_azure_openai_endpoint_invalid");
  }
  const path = endpoint.pathname.replace(/\/+$/u, "");
  if (path && path !== "/openai/v1") {
    throw new Error("browser_azure_openai_endpoint_invalid");
  }
  return `${endpoint.origin}/openai/v1`;
}

export function validateBrowserManagedIdentityBoundary(environment = process.env) {
  if (environment.KOVA_RUNTIME_PLATFORM !== "azure-container-apps") {
    throw new Error("browser_runtime_platform_invalid");
  }
  if (environment.AZURE_OPENAI_USE_MANAGED_IDENTITY !== "true") {
    throw new Error("browser_managed_identity_required");
  }
  if (environment.OPENAI_API_KEY || environment.AZURE_OPENAI_API_KEY) {
    throw new Error("browser_direct_api_key_forbidden");
  }
  endpointBase(required(environment.AZURE_OPENAI_ENDPOINT, "browser_azure_endpoint_required"));
  required(environment.AZURE_OPENAI_DEPLOYMENT_DEEP, "browser_deep_deployment_required");
  required(environment.IDENTITY_ENDPOINT, "browser_identity_endpoint_required");
  required(environment.IDENTITY_HEADER, "browser_identity_header_required");
}

let cachedToken;
let inFlightToken;

async function requestManagedIdentityToken(environment, fetchImpl) {
  if (cachedToken && cachedToken.expiresAtMs - Date.now() > 120_000) {
    return cachedToken.value;
  }
  if (inFlightToken) return inFlightToken;

  inFlightToken = (async () => {
    const endpoint = new URL(
      required(environment.IDENTITY_ENDPOINT, "browser_identity_endpoint_required"),
    );
    if (endpoint.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(endpoint.hostname)) {
      throw new Error("browser_identity_endpoint_invalid");
    }
    endpoint.searchParams.set("resource", AZURE_OPENAI_RESOURCE);
    endpoint.searchParams.set("api-version", "2019-08-01");
    if (environment.AZURE_CLIENT_ID) {
      endpoint.searchParams.set("client_id", environment.AZURE_CLIENT_ID);
    }

    const response = await fetchImpl(endpoint, {
      headers: {
        "X-IDENTITY-HEADER": required(
          environment.IDENTITY_HEADER,
          "browser_identity_header_required",
        ),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("browser_managed_identity_token_failed");
    const payload = await response.json();
    const value = required(payload?.access_token, "browser_managed_identity_token_invalid");
    const expiresOnSeconds = Number(payload?.expires_on ?? 0);
    cachedToken = {
      value,
      expiresAtMs:
        Number.isFinite(expiresOnSeconds) && expiresOnSeconds > 0
          ? expiresOnSeconds * 1000
          : Date.now() + 5 * 60_000,
    };
    return value;
  })();

  try {
    return await inFlightToken;
  } finally {
    inFlightToken = undefined;
  }
}

function outputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function usage(payload) {
  const value = payload?.usage ?? {};
  const input = Number(value.input_tokens ?? 0);
  const output = Number(value.output_tokens ?? 0);
  const total = Number(value.total_tokens ?? input + output);
  return {
    input_tokens: Number.isFinite(input) ? Math.max(0, Math.trunc(input)) : 0,
    output_tokens: Number.isFinite(output) ? Math.max(0, Math.trunc(output)) : 0,
    total_tokens: Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0,
  };
}

function boundedSources(sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 10) {
    throw new Error("browser_research_sources_invalid");
  }
  return sources.map((source, index) => {
    const title = String(source?.title ?? `Source ${index + 1}`).slice(0, 300);
    const url = String(source?.url ?? "").slice(0, 2000);
    const text = String(source?.text ?? "").slice(0, 60_000);
    if (!url || !text) throw new Error("browser_research_source_invalid");
    return { index: index + 1, title, url, text };
  });
}

export async function synthesizeBrowserResearch(
  { objective, sources, tokenBudget, signal },
  environment = process.env,
  fetchImpl = fetch,
) {
  validateBrowserManagedIdentityBoundary(environment);
  const normalizedObjective = required(objective, "browser_research_objective_required").slice(
    0,
    12_000,
  );
  const normalizedSources = boundedSources(sources);
  const budget = Math.max(1_000, Math.min(Number(tokenBudget) || 12_000, 50_000));
  const token = await requestManagedIdentityToken(environment, fetchImpl);
  const base = endpointBase(environment.AZURE_OPENAI_ENDPOINT);
  const deployment = required(
    environment.AZURE_OPENAI_DEPLOYMENT_DEEP,
    "browser_deep_deployment_required",
  );

  const sourceText = normalizedSources
    .map(
      (source) => `[${source.index}] ${source.title}\nURL: ${source.url}\nCONTENT:\n${source.text}`,
    )
    .join("\n\n---\n\n");
  const prompt = [
    "Prepare a factual research report from only the supplied source captures.",
    "Use inline citations like [1] and do not invent sources or external actions.",
    "Clearly identify uncertainty, conflicts, and missing evidence.",
    "Return Markdown with a concise title, executive summary, findings, limitations, and Sources.",
    `OBJECTIVE:\n${normalizedObjective}`,
    `SOURCES:\n${sourceText}`,
  ].join("\n\n");

  const response = await fetchImpl(`${base}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: deployment,
      input: prompt,
      max_output_tokens: Math.min(6_000, budget),
    }),
    signal,
  });
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const error = new Error(
      retryable ? "browser_research_provider_temporary" : "browser_research_provider_failed",
    );
    error.retryable = retryable;
    error.status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }

  const payload = await response.json();
  const report = outputText(payload);
  if (!report) throw new Error("browser_research_provider_empty");
  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("apim-request-id") ?? "";

  return {
    report: report.slice(0, 100_000),
    usage: usage(payload),
    providerRequestId: requestId.slice(0, 200),
  };
}
