export function parseWorkflowSkillMutationResult(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.ok !== true ||
    Object.keys(value).length !== 1
  ) {
    const error = new Error("Workflow skill update could not be confirmed. Try again.");
    error.name = "WorkflowSkillTransportError";
    throw error;
  }
  return { ok: true };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const DETAIL_KEYS = new Set([
  "id",
  "revision",
  "headVersionId",
  "version",
  "name",
  "description",
  "instructions",
  "resources",
  "digest",
  "installationId",
  "installedVersionId",
  "installedVersion",
  "installedName",
  "created_at",
  "updated_at",
]);

function nullable(value, predicate) {
  return value === null || predicate(value);
}

const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isString = (value) => typeof value === "string";

export function parseWorkflowSkillDetailResult(value) {
  const validResource = (resource) =>
    resource !== null &&
    typeof resource === "object" &&
    !Array.isArray(resource) &&
    Object.keys(resource).length === 2 &&
    typeof resource.title === "string" &&
    typeof resource.content === "string";
  const valid =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === DETAIL_KEYS.size &&
    Object.keys(value).every((key) => DETAIL_KEYS.has(key)) &&
    isUuid(value.id) &&
    isPositiveInteger(value.revision) &&
    isUuid(value.headVersionId) &&
    isPositiveInteger(value.version) &&
    isString(value.name) &&
    isString(value.description) &&
    isString(value.instructions) &&
    Array.isArray(value.resources) &&
    value.resources.every(validResource) &&
    isString(value.digest) &&
    DIGEST_PATTERN.test(value.digest) &&
    nullable(value.installationId, isUuid) &&
    nullable(value.installedVersionId, isUuid) &&
    nullable(value.installedVersion, isPositiveInteger) &&
    nullable(value.installedName, isString) &&
    isString(value.created_at) &&
    isString(value.updated_at);
  if (!valid) {
    const error = new Error("Workflow skill details could not be confirmed. Try again.");
    error.name = "WorkflowSkillTransportError";
    throw error;
  }
  return value;
}
