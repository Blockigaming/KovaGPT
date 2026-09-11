export const WORKFLOW_SKILL_LIMITS = Object.freeze({
  nameChars: 120,
  descriptionChars: 500,
  instructionChars: 12_000,
  resourceCount: 10,
  resourceTitleChars: 120,
  resourceContentChars: 8_000,
  totalBytes: 32_000,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function invalid(code) {
  const error = new Error(code);
  error.name = "WorkflowSkillError";
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value, code, maximum, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string") invalid(code);
  const normalized = value.trim();
  if (
    (!optional && !normalized) ||
    normalized.length > maximum ||
    CONTROL_CHARACTERS.test(normalized)
  )
    invalid(code);
  return normalized;
}

export function normalizeWorkflowSkillDraft(value) {
  if (!isRecord(value)) invalid("workflow_skill_invalid");
  const allowed = new Set(["name", "description", "instructions", "resources"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid("workflow_skill_invalid");
  if (
    !Array.isArray(value.resources) ||
    value.resources.length > WORKFLOW_SKILL_LIMITS.resourceCount
  )
    invalid("workflow_skill_resources_invalid");

  const result = {
    name: boundedText(value.name, "workflow_skill_name_invalid", WORKFLOW_SKILL_LIMITS.nameChars),
    description: boundedText(
      value.description,
      "workflow_skill_description_invalid",
      WORKFLOW_SKILL_LIMITS.descriptionChars,
      { optional: true },
    ),
    instructions: boundedText(
      value.instructions,
      "workflow_skill_instructions_invalid",
      WORKFLOW_SKILL_LIMITS.instructionChars,
    ),
    resources: value.resources.map((resource) => {
      if (
        !isRecord(resource) ||
        Object.keys(resource).some((key) => !["title", "content"].includes(key))
      )
        invalid("workflow_skill_resources_invalid");
      return {
        title: boundedText(
          resource.title,
          "workflow_skill_resource_title_invalid",
          WORKFLOW_SKILL_LIMITS.resourceTitleChars,
        ),
        content: boundedText(
          resource.content,
          "workflow_skill_resource_content_invalid",
          WORKFLOW_SKILL_LIMITS.resourceContentChars,
        ),
      };
    }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  if (bytes > WORKFLOW_SKILL_LIMITS.totalBytes) invalid("workflow_skill_too_large");
  return { ...result, sizeBytes: bytes };
}

export function normalizeWorkflowSkillSelection(value, { includeName = false } = {}) {
  if (!isRecord(value)) invalid("workflow_skill_selection_invalid");
  const allowed = new Set(["installationId", "versionId", ...(includeName ? ["name"] : [])]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    invalid("workflow_skill_selection_invalid");
  if (
    !UUID_PATTERN.test(String(value.installationId)) ||
    !UUID_PATTERN.test(String(value.versionId))
  )
    invalid("workflow_skill_selection_invalid");
  const selection = {
    installationId: String(value.installationId).toLowerCase(),
    versionId: String(value.versionId).toLowerCase(),
  };
  if (includeName) {
    selection.name = boundedText(
      value.name,
      "workflow_skill_selection_invalid",
      WORKFLOW_SKILL_LIMITS.nameChars,
    );
  }
  return selection;
}
