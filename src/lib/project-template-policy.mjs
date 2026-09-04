export const PROJECT_TEMPLATE_MAX_BODY_BYTES = 32 * 1024;
export const PROJECT_TEMPLATE_MAX_SNAPSHOT_BYTES = 16 * 1024;
export const PROJECT_TEMPLATE_MAX_RESULTS = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SNAPSHOT_FIELDS = new Set(["projectName", "projectDescription", "systemPrompt", "color"]);

export class ProjectTemplateInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProjectTemplateInputError";
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields) {
  const allowed = new Set(fields);
  return Object.keys(value).every((key) => allowed.has(key));
}

function uuid(value, code) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ProjectTemplateInputError(code);
  }
  return value.toLowerCase();
}

function integer(value, code, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ProjectTemplateInputError(code);
  }
  return value;
}

function cleanText(value, code, max, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "string") throw new ProjectTemplateInputError(code);
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > max || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    throw new ProjectTemplateInputError(code);
  }
  return normalized;
}

function optionalText(value, code, max) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new ProjectTemplateInputError(code);
  const normalized = value.trim();
  const withoutAllowedWhitespace = normalized.replace(/[\n\t]/gu, "");
  if (normalized.length > max || /[\p{Cc}\p{Cf}]/u.test(withoutAllowedWhitespace)) {
    throw new ProjectTemplateInputError(code);
  }
  return normalized || null;
}

function snapshot(value) {
  if (!isRecord(value) || !exactFields(value, SNAPSHOT_FIELDS)) {
    throw new ProjectTemplateInputError("project_template_snapshot_invalid");
  }
  const projectName = cleanText(value.projectName, "project_template_project_name_invalid", 100);
  const projectDescription = optionalText(
    value.projectDescription,
    "project_template_project_description_invalid",
    1000,
  );
  const systemPrompt = optionalText(
    value.systemPrompt,
    "project_template_system_prompt_invalid",
    4000,
  );
  const color = optionalText(value.color, "project_template_color_invalid", 24) ?? "blue";
  if (!/^[a-z0-9#_-]+$/iu.test(color)) {
    throw new ProjectTemplateInputError("project_template_color_invalid");
  }
  const result = { projectName, projectDescription, systemPrompt, color };
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
    PROJECT_TEMPLATE_MAX_SNAPSHOT_BYTES
  ) {
    throw new ProjectTemplateInputError("project_template_snapshot_too_large");
  }
  return result;
}

export function parseProjectTemplateMutation(value) {
  if (!isRecord(value) || typeof value.action !== "string") {
    throw new ProjectTemplateInputError("project_template_request_invalid");
  }
  const mutationId = uuid(value.mutationId, "project_template_mutation_id_invalid");
  if (value.action === "create") {
    if (!exactFields(value, ["action", "mutationId", "name", "description", "snapshot"])) {
      throw new ProjectTemplateInputError("project_template_create_invalid");
    }
    return {
      action: "create",
      mutationId,
      name: cleanText(value.name, "project_template_name_invalid", 100),
      description: optionalText(value.description, "project_template_description_invalid", 1000),
      snapshot: snapshot(value.snapshot),
    };
  }
  if (value.action === "publishVersion") {
    if (
      !exactFields(value, ["action", "mutationId", "templateId", "expectedRevision", "snapshot"])
    ) {
      throw new ProjectTemplateInputError("project_template_version_invalid");
    }
    return {
      action: "publishVersion",
      mutationId,
      templateId: uuid(value.templateId, "project_template_id_invalid"),
      expectedRevision: integer(value.expectedRevision, "project_template_revision_invalid", {
        min: 1,
      }),
      snapshot: snapshot(value.snapshot),
    };
  }
  if (value.action === "share") {
    if (
      !exactFields(value, [
        "action",
        "mutationId",
        "templateId",
        "expectedRevision",
        "granteeUserId",
        "canCopy",
      ]) ||
      typeof value.canCopy !== "boolean"
    ) {
      throw new ProjectTemplateInputError("project_template_share_invalid");
    }
    return {
      action: "share",
      mutationId,
      templateId: uuid(value.templateId, "project_template_id_invalid"),
      expectedRevision: integer(value.expectedRevision, "project_template_revision_invalid", {
        min: 1,
      }),
      granteeUserId: uuid(value.granteeUserId, "project_template_grantee_invalid"),
      canCopy: value.canCopy,
    };
  }
  if (value.action === "revoke") {
    if (
      !exactFields(value, [
        "action",
        "mutationId",
        "templateId",
        "expectedRevision",
        "granteeUserId",
      ])
    ) {
      throw new ProjectTemplateInputError("project_template_revoke_invalid");
    }
    return {
      action: "revoke",
      mutationId,
      templateId: uuid(value.templateId, "project_template_id_invalid"),
      expectedRevision: integer(value.expectedRevision, "project_template_revision_invalid", {
        min: 1,
      }),
      granteeUserId: uuid(value.granteeUserId, "project_template_grantee_invalid"),
    };
  }
  if (value.action === "archive") {
    if (!exactFields(value, ["action", "mutationId", "templateId", "expectedRevision"])) {
      throw new ProjectTemplateInputError("project_template_archive_invalid");
    }
    return {
      action: "archive",
      mutationId,
      templateId: uuid(value.templateId, "project_template_id_invalid"),
      expectedRevision: integer(value.expectedRevision, "project_template_revision_invalid", {
        min: 1,
      }),
    };
  }
  if (value.action === "copy") {
    if (!exactFields(value, ["action", "mutationId", "templateId", "version"])) {
      throw new ProjectTemplateInputError("project_template_copy_invalid");
    }
    return {
      action: "copy",
      mutationId,
      templateId: uuid(value.templateId, "project_template_id_invalid"),
      version:
        value.version === undefined || value.version === null
          ? null
          : integer(value.version, "project_template_version_invalid", { min: 1 }),
    };
  }
  throw new ProjectTemplateInputError("project_template_action_invalid");
}

export function parseProjectTemplateQuery(urlValue) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  if (
    [...url.searchParams.keys()].some((key) => !["templateId", "version", "limit"].includes(key))
  ) {
    throw new ProjectTemplateInputError("project_template_query_invalid");
  }
  for (const key of ["templateId", "version", "limit"]) {
    if (url.searchParams.getAll(key).length > 1) {
      throw new ProjectTemplateInputError("project_template_query_invalid");
    }
  }
  const templateIdRaw = url.searchParams.get("templateId");
  const versionRaw = url.searchParams.get("version");
  if (versionRaw !== null && templateIdRaw === null) {
    throw new ProjectTemplateInputError("project_template_query_invalid");
  }
  const limitRaw = url.searchParams.get("limit") ?? "25";
  if (!/^[1-9]\d*$/u.test(limitRaw) || (versionRaw !== null && !/^[1-9]\d*$/u.test(versionRaw))) {
    throw new ProjectTemplateInputError("project_template_query_invalid");
  }
  return {
    templateId: templateIdRaw === null ? null : uuid(templateIdRaw, "project_template_id_invalid"),
    version:
      versionRaw === null
        ? null
        : integer(Number(versionRaw), "project_template_version_invalid", { min: 1 }),
    limit: integer(Number(limitRaw), "project_template_limit_invalid", {
      min: 1,
      max: PROJECT_TEMPLATE_MAX_RESULTS,
    }),
  };
}

export function projectTemplateErrorStatus(code) {
  if (code === "40001" || code === "23505") return 409;
  if (code === "P0002") return 404;
  if (code === "42501") return 403;
  if (code === "22023" || code === "23514") return 400;
  return 503;
}
