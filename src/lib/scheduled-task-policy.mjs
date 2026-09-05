export const TASK_CONTEXT_MAX_CHARS = 24_000;
export const TASK_PROVIDERS = Object.freeze(["gmail", "slack", "github"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const fail = () => {
  throw new Error("task_request_invalid");
};
function keys(value, allowed) {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail();
}
function text(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
  )
    fail();
  return value.trim();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  return value;
}
function validLocalTime(value) {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/u.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
  );
}
export function taskTimezone(value = "UTC") {
  value = text(value, 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    fail();
  }
}
export function taskResource(provider, value) {
  value = text(value, 200);
  if (provider === "gmail" && !/^[a-f0-9]{1,80}$/iu.test(value)) fail();
  if (provider === "slack" && !/^[CG][A-Z0-9]{8,30}$/u.test(value)) fail();
  if (
    provider === "github" &&
    !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(?:\/[1-9][0-9]{0,8})?$/u.test(value)
  )
    fail();
  if (
    !TASK_PROVIDERS.includes(provider) ||
    value.split("/").some((part) => part === "." || part === "..")
  )
    fail();
  return value;
}
export function parseTaskContext(value = []) {
  if (!Array.isArray(value) || value.length > 8) fail();
  const result = value.map((ref) => {
    if (ref?.kind === "snapshot") {
      keys(ref, ["kind", "text", "sourceChatId", "capturedAt"]);
      return {
        kind: "snapshot",
        text: text(ref.text, 14_000),
        sourceChatId: text(ref.sourceChatId, 256),
        capturedAt: new Date(text(ref.capturedAt, 40)).toISOString(),
      };
    }
    if (ref?.kind === "library") {
      keys(ref, ["kind", "id"]);
      return { kind: "library", id: id(ref.id) };
    }
    if (ref?.kind === "project_file") {
      keys(ref, ["kind", "id", "projectId"]);
      return { kind: "project_file", id: id(ref.id), projectId: id(ref.projectId) };
    }
    if (ref?.kind === "connected") {
      keys(ref, ["kind", "grantId", "provider", "resource"]);
      return {
        kind: "connected",
        grantId: id(ref.grantId),
        provider: ref.provider,
        resource: taskResource(ref.provider, ref.resource),
      };
    }
    fail();
  });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 28_000) fail();
  return result;
}
export function parseTaskTriggers(value = []) {
  if (!Array.isArray(value) || value.length > 3) fail();
  return value.map((trigger) => {
    keys(trigger, [
      "provider",
      "grantId",
      "resource",
      "author",
      "contains",
      "label",
      "includeReplies",
      "activities",
    ]);
    const provider = trigger.provider;
    if (!TASK_PROVIDERS.includes(provider)) fail();
    const result = {
      provider,
      grantId: id(trigger.grantId),
      resource: provider === "gmail" ? "inbox" : taskResource(provider, trigger.resource),
    };
    for (const key of ["author", "contains", "label"])
      if (trigger[key] !== undefined) result[key] = text(trigger[key], 120);
    if (trigger.includeReplies !== undefined) {
      if (provider !== "slack" || typeof trigger.includeReplies !== "boolean") fail();
      result.includeReplies = trigger.includeReplies;
    }
    if (trigger.activities !== undefined) {
      if (
        provider !== "github" ||
        !Array.isArray(trigger.activities) ||
        !trigger.activities.length ||
        trigger.activities.length > 6 ||
        trigger.activities.some(
          (item) =>
            !["opened", "synchronize", "closed", "review", "comment", "merged"].includes(item),
        )
      )
        fail();
      result.activities = [...new Set(trigger.activities)];
    }
    return result;
  });
}
export function parseTaskPayload(value, partial = false) {
  keys(value, [
    "title",
    "prompt",
    "run_at",
    "repeat",
    "timezone",
    "localTime",
    "triggerMode",
    "contextRefs",
    "eventTriggers",
  ]);
  const result = {};
  for (const key of ["title", "prompt"])
    if (!partial || value[key] !== undefined)
      result[key] = text(value[key], key === "title" ? 200 : 4000);
  if (value.run_at !== undefined) {
    const input = text(value.run_at, 40);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/u.test(input) ||
      !validLocalTime(input) ||
      !Number.isFinite(Date.parse(input))
    )
      fail();
    result.run_at = input;
  }
  if (value.localTime !== undefined) {
    const input = text(value.localTime, 30);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/u.test(input) ||
      !validLocalTime(input) ||
      !Number.isFinite(Date.parse(input + "Z"))
    )
      fail();
    result.localTime = input;
  }
  if (value.timezone !== undefined || !partial) result.timezone = taskTimezone(value.timezone);
  if (value.repeat !== undefined || !partial) {
    result.repeat = value.repeat ?? "none";
    if (!["none", "daily", "weekly", "monthly"].includes(result.repeat)) fail();
  }
  if (value.triggerMode !== undefined || !partial) {
    result.triggerMode = value.triggerMode ?? "time";
    if (!["time", "event"].includes(result.triggerMode)) fail();
  }
  if (value.contextRefs !== undefined || !partial)
    result.contextRefs = parseTaskContext(value.contextRefs);
  if (value.eventTriggers !== undefined || !partial)
    result.eventTriggers = parseTaskTriggers(value.eventTriggers);
  if (!partial) {
    if (
      result.triggerMode === "time" &&
      ((!result.localTime && !result.run_at) || result.eventTriggers.length)
    )
      fail();
    if (
      result.triggerMode === "event" &&
      (result.repeat !== "none" ||
        !result.eventTriggers.length ||
        value.run_at !== undefined ||
        value.localTime !== undefined)
    )
      fail();
  }
  return result;
}
export function consumerTaskBounds(model, config, estimatedInputTokens) {
  const maxOutput = Math.min(1800, model.outputCeiling, model.maxOutputTokens);
  const inputTokens = Math.ceil(estimatedInputTokens) + 256;
  const maxCost =
    (inputTokens * model.pricePerMillion.input + maxOutput * model.pricePerMillion.output) /
    1_000_000;
  if (
    !config.generationEnabled ||
    !Number.isFinite(maxCost) ||
    maxCost > config.maxCostUsdPerRequest ||
    maxOutput < 1 ||
    inputTokens > 16_000
  )
    throw new Error("task_cost_admission_failed");
  return { maxOutput, inputTokens, maxCost };
}
