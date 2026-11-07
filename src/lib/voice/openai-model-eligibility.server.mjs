import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RECORD_ID = /^[A-Za-z0-9._:-]{1,200}$/u;
const RECEIPT = /^([A-Za-z0-9_-]{1,1800})\.([A-Za-z0-9_-]{43})$/u;
const APPROVED_HOSTED_MODELS = new Set(["kova-xenon-5", "kova-neon-4.6", "kova-argon-4.6"]);

function configuredModels(raw) {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const value = JSON.parse(raw);
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > 32 ||
      value.some((model) => typeof model !== "string" || !MODEL_ID.test(model)) ||
      new Set(value).size !== value.length
    )
      return null;
    return new Set(value);
  } catch {
    return null;
  }
}

/** Explicit operator allowlists and a separate signing key gate speech. */
export function voiceModelPolicy(env) {
  const openaiRaw = env?.("KOVA_VOICE_OPENAI_MODELS_JSON");
  const hostedRaw = env?.("KOVA_VOICE_HOSTED_MODELS_JSON");
  const openaiPresent = typeof openaiRaw === "string" && openaiRaw.length > 0;
  const hostedPresent = typeof hostedRaw === "string" && hostedRaw.length > 0;
  const models = openaiPresent ? configuredModels(openaiRaw) : new Set();
  const hostedModels = hostedPresent ? configuredModels(hostedRaw) : new Set();
  const secret = env?.("KOVA_VOICE_MODEL_PROOF_SECRET");
  const valid =
    (openaiPresent || hostedPresent) &&
    models instanceof Set &&
    hostedModels instanceof Set &&
    [...hostedModels].every((model) => APPROVED_HOSTED_MODELS.has(model)) &&
    typeof secret === "string" &&
    Buffer.byteLength(secret, "utf8") >= 32;
  if (!valid) return { valid: false, models: new Set(), hostedModels: new Set() };
  return { valid: true, models, hostedModels, secret };
}

export function eligibleVoiceModel(policy, { provider, modelId } = {}) {
  if (policy?.valid !== true || typeof modelId !== "string" || !MODEL_ID.test(modelId))
    return false;
  if (provider === "openai" || provider === "azure_openai")
    return policy.models instanceof Set && policy.models.has(modelId);
  return (
    provider === "openrouter" &&
    policy.hostedModels instanceof Set &&
    APPROVED_HOSTED_MODELS.has(modelId) &&
    policy.hostedModels.has(modelId)
  );
}

function validIdentity({ ownerId, chatId, messageId, content } = {}) {
  return (
    typeof ownerId === "string" &&
    RECORD_ID.test(ownerId) &&
    typeof chatId === "string" &&
    RECORD_ID.test(chatId) &&
    typeof messageId === "string" &&
    RECORD_ID.test(messageId) &&
    typeof content === "string" &&
    content.length > 0 &&
    Buffer.byteLength(content, "utf8") <= 128 * 1024
  );
}

function contentDigest(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function signature(secret, encoded) {
  return createHmac("sha256", secret).update(encoded, "ascii").digest();
}

/** Call only after an authenticated, completed eligible chat turn. */
export function issueVoiceModelReceipt(
  policy,
  { ownerId, chatId, messageId, content, provider, modelId } = {},
) {
  if (
    !validIdentity({ ownerId, chatId, messageId, content }) ||
    !eligibleVoiceModel(policy, { provider, modelId }) ||
    typeof policy.secret !== "string"
  )
    return null;
  const payload = {
    v: 1,
    p: provider,
    m: modelId,
    o: ownerId,
    c: chatId,
    i: messageId,
    h: contentDigest(content),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(policy.secret, encoded).toString("base64url")}`;
}

/** Verify the persisted reply's exact owner, chat, message and content before voice spending. */
export function verifyVoiceModelReceipt(
  policy,
  receipt,
  { ownerId, chatId, messageId, content } = {},
) {
  if (
    policy?.valid !== true ||
    typeof policy.secret !== "string" ||
    !validIdentity({ ownerId, chatId, messageId, content }) ||
    typeof receipt !== "string"
  )
    return null;
  const match = RECEIPT.exec(receipt);
  if (!match) return null;
  const [, encoded, encodedSignature] = match;
  const supplied = Buffer.from(encodedSignature, "base64url");
  if (
    supplied.length !== 32 ||
    supplied.toString("base64url") !== encodedSignature ||
    !timingSafeEqual(supplied, signature(policy.secret, encoded))
  )
    return null;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return null;
    const payload = JSON.parse(bytes.toString("utf8"));
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !== "c,h,i,m,o,p,v" ||
      payload.v !== 1 ||
      payload.o !== ownerId ||
      payload.c !== chatId ||
      payload.i !== messageId ||
      payload.h !== contentDigest(content) ||
      !eligibleVoiceModel(policy, { provider: payload.p, modelId: payload.m })
    )
      return null;
    return { provider: payload.p, modelId: payload.m };
  } catch {
    return null;
  }
}
