// Server-owned catalog: client selection is an opaque ID, never a provider ID.
export const TTS_MODEL_IDS = Object.freeze([
  "eleven_flash_v2_5",
  "eleven_multilingual_v2",
  "eleven_v4",
]);
const PLANS = new Set(["free", "plus", "pro"]);
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const PROVIDER_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export function readVoiceCatalog(env, tier) {
  if (!PLANS.has(tier)) return { valid: false, entries: [], defaultVoiceId: null };
  const raw = env("KOVA_VOICE_CATALOG");
  let entries;
  if (raw !== undefined) {
    try {
      if (raw.length > 32768) throw new Error("oversize");
      entries = JSON.parse(raw);
      if (!Array.isArray(entries) || entries.length < 1 || entries.length > 32)
        throw new Error("invalid");
      const ids = new Set();
      entries = entries.map((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          Array.isArray(entry) ||
          !ID.test(entry.id ?? "") ||
          typeof entry.id !== "string" ||
          ids.has(entry.id) ||
          typeof entry.label !== "string" ||
          !entry.label.trim() ||
          entry.label.length > 80 ||
          /[\u0000-\u001f\u007f]/u.test(entry.label) ||
          typeof entry.providerVoiceId !== "string" ||
          !PROVIDER_ID.test(entry.providerVoiceId) ||
          (entry.modelId !== undefined && !TTS_MODEL_IDS.includes(entry.modelId)) ||
          !Array.isArray(entry.allowedPlans) ||
          entry.allowedPlans.length < 1 ||
          entry.allowedPlans.length > 3 ||
          new Set(entry.allowedPlans).size !== entry.allowedPlans.length ||
          !entry.allowedPlans.every((plan) => PLANS.has(plan)) ||
          (entry.showWhenLocked !== undefined && typeof entry.showWhenLocked !== "boolean")
        )
          throw new Error("invalid");
        ids.add(entry.id);
        return {
          id: entry.id,
          label: entry.label.trim(),
          providerVoiceId: entry.providerVoiceId,
          modelId: entry.modelId ?? "eleven_multilingual_v2",
          allowedPlans: [...entry.allowedPlans],
          showWhenLocked: entry.showWhenLocked === true,
          available: entry.allowedPlans.includes(tier),
        };
      });
    } catch {
      return { valid: false, entries: [], defaultVoiceId: null };
    }
  } else {
    const providerVoiceId = env("ELEVENLABS_VOICE_ID");
    // Preserve the previous single configured voice's access, without defining
    // any new plan-to-voice commercial mapping.
    entries =
      typeof providerVoiceId === "string" && PROVIDER_ID.test(providerVoiceId)
        ? [
            {
              id: "default",
              label: "Default voice",
              providerVoiceId,
              modelId: "eleven_multilingual_v2",
              allowedPlans: ["free", "plus", "pro"],
              showWhenLocked: false,
              available: true,
            },
          ]
        : [];
  }
  const preferred = env("KOVA_VOICE_DEFAULT_ID");
  if (preferred !== undefined && !entries.some((entry) => entry.id === preferred))
    return { valid: false, entries: [], defaultVoiceId: null };
  const selected =
    entries.find((entry) => entry.id === preferred && entry.available) ??
    entries.find((entry) => entry.available);
  return { valid: true, entries, defaultVoiceId: selected?.id ?? null };
}
export function publicVoiceCatalog(catalog) {
  return catalog.entries
    .filter((entry) => entry.available || entry.showWhenLocked)
    .map(({ id, label, available }) => ({ id, label, available }));
}
export function selectCatalogVoice(catalog, requestedId) {
  if (requestedId !== undefined && (typeof requestedId !== "string" || !ID.test(requestedId)))
    return { error: "invalid_voice", status: 400 };
  const selectedId = requestedId ?? catalog.defaultVoiceId;
  const entry = catalog.entries.find((entry) => entry.id === selectedId);
  if (!entry) return { error: "invalid_voice", status: 400 };
  if (!entry.available) return { error: "voice_plan_required", status: 403 };
  return { providerVoiceId: entry.providerVoiceId, modelId: entry.modelId, catalogId: entry.id };
}
