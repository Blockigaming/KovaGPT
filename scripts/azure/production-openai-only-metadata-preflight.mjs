import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Public extraction of the reviewed bounded reader. Actual vault references
// come from the authenticated production app, never public source or inputs.
// Execution stdout contains private reference metadata: capture/encrypt it.
const MODELS = ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"];
const PROVIDER_URL = "https://api.openai.com/v1/models";
const MAX_BODY = 262144;
const fail = () => {
  throw new Error("production_metadata_preflight_failed");
};
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function targetFromEnvironment(env) {
  const subscription = env.KOVA_METADATA_SUBSCRIPTION_ID;
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(subscription ?? "") ||
    env.KOVA_METADATA_RESOURCE_GROUP !== "rg-kovagpt-prod" ||
    env.KOVA_METADATA_CONTAINER_APP !== "kovagpt-prod-web"
  )
    fail();
  const group = `/subscriptions/${subscription}/resourceGroups/rg-kovagpt-prod`;
  return Object.freeze({
    subscription,
    resourceGroup: env.KOVA_METADATA_RESOURCE_GROUP,
    app: env.KOVA_METADATA_CONTAINER_APP,
    appId: `${group}/providers/Microsoft.App/containerApps/kovagpt-prod-web`,
    identityId: `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-kovagpt-prod`,
  });
}

export function admitExistingReference(app, target) {
  if (
    !object(app) ||
    app.name !== target.app ||
    typeof app.id !== "string" ||
    app.id.toLowerCase() !== target.appId.toLowerCase() ||
    !String(app.identity?.type).includes("UserAssigned") ||
    !object(app.identity?.userAssignedIdentities) ||
    !Object.keys(app.identity.userAssignedIdentities).some(
      (id) => id.toLowerCase() === target.identityId.toLowerCase(),
    )
  )
    fail();
  const slots = app.properties?.configuration?.secrets;
  if (!Array.isArray(slots)) fail();
  const matches = slots.filter((slot) => slot?.name === "openai-api-key");
  if (matches.length !== 1) fail();
  const slot = matches[0];
  if (
    typeof slot.identity !== "string" ||
    slot.identity.toLowerCase() !== target.identityId.toLowerCase() ||
    typeof slot.keyVaultUrl !== "string" ||
    !/^https:\/\/[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net\/secrets\/openai-api-key\/[a-f0-9]{32}$/u.test(
      slot.keyVaultUrl,
    ) ||
    slot.value != null
  )
    fail();
  return Object.freeze({ versionedKeyVaultUrl: slot.keyVaultUrl, identityId: target.identityId });
}

function cleanAzureEnvironment(env) {
  const child = {};
  for (const name of [
    "PATH",
    "HOME",
    "AZURE_CONFIG_DIR",
    "ACC_CLOUD",
    "MSI_ENDPOINT",
    "AZUREPS_HOST_ENVIRONMENT",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
  ])
    if (typeof env[name] === "string") child[name] = env[name];
  return Object.assign(child, {
    AZURE_LOGGING_ENABLE_LOG_FILE: "false",
    AZURE_CORE_LOG_LEVEL: "critical",
    AZURE_LOG_LEVEL: "critical",
    AZURE_CORE_COLLECT_TELEMETRY: "false",
    AZURE_CORE_ONLY_SHOW_ERRORS: "true",
  });
}

function classify(result) {
  if (result?.error?.code === "ETIMEDOUT") return "timeout";
  const text = Buffer.isBuffer(result?.stderr)
    ? result.stderr.subarray(0, 8192).toString("utf8")
    : "";
  if (
    /ForbiddenByFirewall|ForbiddenByConnection|PublicNetworkAccessDisabled|firewall|ENOTFOUND|ECONNREFUSED/iu.test(
      text,
    )
  )
    return "network_or_firewall";
  if (
    /az login|AADSTS|ExpiredAuthenticationToken|InvalidAuthenticationToken|AuthenticationFailed|reauthenticat/iu.test(
      text,
    )
  )
    return "azure_cli_auth_required";
  if (
    /ForbiddenByRbac|AccessDenied|AuthorizationFailed|Forbidden|not authorized|permission denied|403/iu.test(
      text,
    )
  )
    return "authorization_denied";
  return "private_read_failed";
}

function azureRead(args, { timeout, maxBuffer, env, spawn }) {
  let result;
  try {
    result = spawn("az", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "buffer",
      maxBuffer,
      timeout,
      killSignal: "SIGKILL",
      env: cleanAzureEnvironment(env),
    });
    if (result.error || result.status !== 0 || result.signal || !Buffer.isBuffer(result.stdout))
      throw Object.assign(new Error("private_read_failed"), { reason: classify(result) });
    return new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
  } finally {
    if (Buffer.isBuffer(result?.stdout)) result.stdout.fill(0);
    if (Buffer.isBuffer(result?.stderr)) result.stderr.fill(0);
  }
}

function withAbort(promise, signal) {
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(new Error("metadata_deadline"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise)
      .then(resolvePromise, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

async function modelMetadata(key, fetcher) {
  const signal = AbortSignal.timeout(8000);
  let response, reader;
  const chunks = [];
  let total = 0;
  try {
    response = await withAbort(
      fetcher(PROVIDER_URL, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal,
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      }),
      signal,
    );
    if (response.redirected || (response.url && response.url !== PROVIDER_URL))
      return { status: "redirect_rejected" };
    if (!response.ok)
      return {
        status: [401, 403].includes(response.status)
          ? "authorization_denied"
          : response.status === 429
            ? "rate_limited"
            : "provider_unavailable",
      };
    const length = response.headers.get("content-length");
    if (
      !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") ||
      (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY)) ||
      !response.body
    )
      fail();
    reader = response.body.getReader();
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await withAbort(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) fail();
      chunks.push(value);
    }
    const joined = Buffer.concat(chunks, total);
    let data;
    try {
      data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
    } finally {
      joined.fill(0);
    }
    if (!object(data) || !Array.isArray(data.data)) fail();
    return {
      status: "available",
      intendedModels: MODELS.map((modelId) => ({
        modelId,
        metadataListed: data.data.some(
          (row) => object(row) && row.id === modelId && row.object === "model",
        ),
      })),
    };
  } catch {
    return { status: signal.aborted ? "timed_out" : "request_or_metadata_failed" };
  } finally {
    try {
      (reader?.cancel() ?? response?.body?.cancel())?.catch(() => {});
    } catch {}
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function inspectOpenAiMetadata(env, { spawn = spawnSync, fetcher = fetch } = {}) {
  const target = targetFromEnvironment(env);
  const report = {
    version: 1,
    operation: "openai-model-list-metadata-only",
    collectedAt: new Date().toISOString(),
    actualAppReadAttempts: 0,
    actualVaultReadAttempts: 0,
    actualProviderGetAttempts: 0,
    maximumAppReadAttempts: 1,
    maximumVaultReadAttempts: 1,
    maximumProviderGetAttempts: 1,
    elevenLabsVaultReads: 0,
    elevenLabsProviderGets: 0,
    generationRequests: 0,
    applicationChanges: 0,
    openAI: { status: "private_read_unavailable" },
    generationUsabilityVerified: false,
    billingUsabilityVerified: false,
    deployedRuntimeBindingVerified: false,
  };
  let key;
  try {
    report.actualAppReadAttempts += 1;
    const raw = azureRead(
      [
        "containerapp",
        "show",
        "--name",
        target.app,
        "--resource-group",
        target.resourceGroup,
        "--subscription",
        target.subscription,
        "--output",
        "json",
        "--only-show-errors",
      ],
      { timeout: 6000, maxBuffer: 524288, env, spawn },
    );
    const reference = admitExistingReference(JSON.parse(raw), target);
    report.existingReference = reference;
    report.actualVaultReadAttempts += 1;
    key = azureRead(
      [
        "keyvault",
        "secret",
        "show",
        "--id",
        reference.versionedKeyVaultUrl,
        "--query",
        "value",
        "--output",
        "tsv",
        "--only-show-errors",
      ],
      { timeout: 12000, maxBuffer: 8192, env, spawn },
    ).replace(/\r?\n$/u, "");
    if (!/^sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,4096}$/u.test(key)) fail();
    report.actualProviderGetAttempts += 1;
    report.openAI = await modelMetadata(key, fetcher);
    if (JSON.stringify(report).includes(key)) fail();
  } catch (error) {
    report.openAI = {
      status: [
        "timeout",
        "network_or_firewall",
        "azure_cli_auth_required",
        "authorization_denied",
        "private_read_failed",
      ].includes(error?.reason)
        ? error.reason
        : "configuration_or_private_read_failed",
    };
  } finally {
    key = null;
  }
  return report;
}

export async function main(
  argv = process.argv.slice(2),
  { env = process.env, inspect = inspectOpenAiMetadata } = {},
) {
  if (!argv.length)
    return { enabled: false, actualVaultReadAttempts: 0, actualProviderGetAttempts: 0 };
  if (
    argv.length !== 1 ||
    argv[0] !== "--execute" ||
    process.platform !== "linux" ||
    Number(process.versions.node.split(".")[0]) !== 24 ||
    process.execArgv.length
  )
    fail();
  for (const name of [
    "NODE_OPTIONS",
    "NODE_DEBUG",
    "NODE_DEBUG_NATIVE",
    "NODE_V8_COVERAGE",
    "SSLKEYLOGFILE",
    "NODE_EXTRA_CA_CERTS",
  ])
    if (env[name]) fail();
  if (env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined && env.NODE_TLS_REJECT_UNAUTHORIZED !== "1")
    fail();
  return inspect(env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch {
    process.stderr.write("production_metadata_preflight_failed\n");
    process.exitCode = 1;
  }
}
