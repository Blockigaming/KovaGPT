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
  "versions",
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
  const validVersion = (version) =>
    version !== null &&
    typeof version === "object" &&
    !Array.isArray(version) &&
    Object.keys(version).length === 5 &&
    isUuid(version.id) &&
    isPositiveInteger(version.version) &&
    isString(version.name) &&
    isString(version.digest) &&
    DIGEST_PATTERN.test(version.digest) &&
    isString(version.created_at);
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
    Array.isArray(value.versions) &&
    value.versions.length >= 1 &&
    value.versions.length <= 30 &&
    value.versions.every(validVersion) &&
    value.versions.every(
      (version, index) => index === 0 || value.versions[index - 1].version > version.version,
    ) &&
    value.versions[0].id === value.headVersionId &&
    value.versions[0].version === value.version &&
    value.versions[0].name === value.name &&
    value.versions[0].digest === value.digest &&
    isString(value.digest) &&
    DIGEST_PATTERN.test(value.digest) &&
    nullable(value.installationId, isUuid) &&
    nullable(value.installedVersionId, isUuid) &&
    nullable(value.installedVersion, isPositiveInteger) &&
    nullable(value.installedName, isString) &&
    (value.installedVersionId === null
      ? value.installedVersion === null && value.installedName === null
      : value.versions.some(
          (version) =>
            version.id === value.installedVersionId &&
            version.version === value.installedVersion &&
            version.name === value.installedName,
        )) &&
    isString(value.created_at) &&
    isString(value.updated_at);
  if (!valid) {
    const error = new Error("Workflow skill details could not be confirmed. Try again.");
    error.name = "WorkflowSkillTransportError";
    throw error;
  }
  return value;
}
