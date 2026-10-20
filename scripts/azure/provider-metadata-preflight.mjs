import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";

// Metadata only. These are the complete allowed network operations; there is
// no endpoint override, generation route, provider SDK, retry or secret lookup.
// https://developers.openai.com/api/reference/resources/models/methods/retrieve
// https://elevenlabs.io/docs/api-reference/voices/get
// https://elevenlabs.io/docs/api-reference/models/list
// https://elevenlabs.io/docs/api-reference/user/subscription/get
const TEXT_MODEL = "gpt-5.6-luna";
const SPEECH_MODEL = "eleven_multilingual_v2";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => {
  throw new Error(`provider_metadata_${code}`);
};
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function providerMetadataConfiguration(env) {
  if (
    env.KOVA_PROVIDER_METADATA_INSPECTION_ENABLED !== "true" ||
    env.AZURE_ENVIRONMENT !== "staging" ||
    env.KOVA_DEPLOYMENT_TARGET !== "ca-kovagpt-staging"
  )
    fail("inspection_disabled");
  const key = (name) => {
    const value = env[name];
    if (
      typeof value !== "string" ||
      value.length < 16 ||
      value.length > 4096 ||
      /[\s\u0000-\u001f\u007f]/u.test(value)
    )
      fail("private_configuration_missing");
    return value;
  };
  const voiceId = env.ELEVENLABS_VOICE_ID;
  if (typeof voiceId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(voiceId))
    fail("voice_binding_missing");
  return { openAIKey: key("OPENAI_API_KEY"), elevenLabsKey: key("ELEVENLABS_API_KEY"), voiceId };
}

function waitBounded(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolveValue, reject) => {
    const abort = () => reject(new Error("provider_metadata_request_timeout"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation)
      .then(resolveValue, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

function discard(response) {
  try {
    void Promise.resolve(response?.body?.cancel()).catch(() => {});
  } catch {
    /* best effort */
  }
}

function httpStatus(status) {
  if (status === 401 || status === 403) return "authorization_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "provider_unavailable";
}

async function metadataRequest(url, headers, { fetcher, deadline, timeoutMs }) {
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(timeoutMs)]);
  let response;
  try {
    response = await waitBounded(
      fetcher(url, {
        method: "GET",
        headers: { ...headers, Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal,
      }),
      signal,
    );
    if (response.redirected || (response.url && response.url !== url)) {
      discard(response);
      return { status: "redirect_rejected" };
    }
    if (!response.ok) {
      const status = httpStatus(response.status);
      discard(response);
      return { status };
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) {
      discard(response);
      return { status: "invalid_metadata" };
    }
    const bytes = await readResponseBytesBounded(response, 131072, { signal, timeoutMs });
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return { status: "available", value, responseSha256: sha256(bytes) };
  } catch {
    discard(response);
    return { status: signal.aborted ? "timed_out" : "request_or_metadata_failed" };
  }
}

const observation = ({ status, responseSha256 }) => ({
  status,
  ...(responseSha256 ? { responseSha256 } : {}),
});

/** Return redacted observations, never a readiness or spending authorization. */
export async function inspectProviderMetadata(
  config,
  { fetcher = fetch, now = Date.now, timeoutMs = 8000 } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000)
    fail("deadline_invalid");
  // Revalidate callers of the exported function; the CLI is not the only entry.
  config = providerMetadataConfiguration({
    KOVA_PROVIDER_METADATA_INSPECTION_ENABLED: "true",
    AZURE_ENVIRONMENT: "staging",
    KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
    OPENAI_API_KEY: config?.openAIKey,
    ELEVENLABS_API_KEY: config?.elevenLabsKey,
    ELEVENLABS_VOICE_ID: config?.voiceId,
  });
  const deadline = AbortSignal.timeout(35000);
  const request = (url, headers) => metadataRequest(url, headers, { fetcher, deadline, timeoutMs });
  let requestCount = 0;
  const get = async (url, headers) => {
    requestCount++;
    return request(url, headers);
  };
  const openAI = await get(`https://api.openai.com/v1/models/${TEXT_MODEL}`, {
    Authorization: `Bearer ${config.openAIKey}`,
  });
  const voice = await get(`https://api.elevenlabs.io/v1/voices/${config.voiceId}`, {
    "xi-api-key": config.elevenLabsKey,
  });
  const models = await get("https://api.elevenlabs.io/v1/models", {
    "xi-api-key": config.elevenLabsKey,
  });
  const subscription = await get("https://api.elevenlabs.io/v1/user/subscription", {
    "xi-api-key": config.elevenLabsKey,
  });

  const modelMatches =
    object(openAI.value) && openAI.value.object === "model" && openAI.value.id === TEXT_MODEL;
  const voiceMatches = object(voice.value) && voice.value.voice_id === config.voiceId;
  const speechModels = Array.isArray(models.value)
    ? models.value.filter((entry) => object(entry) && entry.model_id === SPEECH_MODEL)
    : [];
  const speechModelListed =
    speechModels.length === 1 && speechModels[0].can_do_text_to_speech === true;
  const sub = object(subscription.value) ? subscription.value : null;
  const subscriptionShape =
    sub &&
    typeof sub.status === "string" &&
    count(sub.character_count) &&
    count(sub.character_limit);
  const overage = !sub
    ? "unknown"
    : sub.max_credit_limit_extension === 0
      ? "disabled"
      : sub.max_credit_limit_extension === "unlimited"
        ? "unlimited"
        : count(sub.max_credit_limit_extension) && sub.max_credit_limit_extension > 0
          ? "capped"
          : "unknown";
  const report = {
    version: 1,
    status: "METADATA_OBSERVATIONS_ONLY_NOT_LIVE_QUALIFICATION",
    collectedAt: new Date(now()).toISOString(),
    target: "ca-kovagpt-staging",
    requestCount,
    generationRequests: 0,
    openAI: { ...observation(openAI), modelId: TEXT_MODEL, modelMetadataMatches: modelMatches },
    elevenLabs: {
      voice: {
        ...observation(voice),
        selectedVoiceSha256: sha256(config.voiceId),
        selectedVoiceMetadataMatches: voiceMatches,
      },
      models: {
        ...observation(models),
        modelId: SPEECH_MODEL,
        textToSpeechModelListed: speechModelListed,
      },
      subscription: {
        ...observation(subscription),
        statusReportedActive: subscriptionShape ? sub.status === "active" : null,
        positiveCreditHeadroom: subscriptionShape
          ? sub.character_limit > sub.character_count
          : null,
        overageMode: overage,
      },
    },
    generationUsabilityVerified: false,
    textToSpeechKeyPermissionVerified: false,
    exactTokenCountVerified: false,
    accountPricingVerified: false,
    aggregateCostBoundVerified: false,
    shutdownVerified: false,
    executionAuthorityGranted: false,
  };
  return { ...report, reportSha256: sha256(JSON.stringify(report)) };
}

export async function main(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (argv.length !== 1 || argv[0] !== "--inspect-metadata") {
    return {
      inspectionEnabled: false,
      reason: "explicit_metadata_inspection_required",
      requestCount: 0,
      generationRequests: 0,
    };
  }
  return inspectProviderMetadata(providerMetadataConfiguration(env), dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await main())}\n`);
  } catch (error) {
    process.stderr.write(
      `${/^provider_metadata_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "provider_metadata_inspection_failed"}\n`,
    );
    process.exitCode = 1;
  }
}
