import { BoundedJsonError, readBoundedJsonObject } from "../lib/bounded-json.server.mjs";

export const AGENT_TEAM_CREATE_BODY_LIMIT_BYTES = 512 * 1024;
export const AGENT_RUN_CONTROL_BODY_LIMIT_BYTES = 4 * 1024;
export const AGENT_TEAM_CONTROL_BODY_LIMIT_BYTES = 4 * 1024;
export const AGENT_TEAM_MAX_TASKS = 40;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SINGLE_LINE_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;
const MULTILINE_PATTERN = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u;
const AGENT_ROLES = new Set([
  "planner",
  "research",
  "browser",
  "file",
  "coding",
  "writing",
  "review",
]);

export class AgentRequestError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "AgentRequestError";
    this.code = code;
    this.status = status;
    this.publicMessage = code;
  }
}

function fail(code, status = 400) {
  throw new AgentRequestError(code, status);
}

function isRecord(value) {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function strictRecord(value, allowedKeys, code) {
  if (!isRecord(value)) fail(code);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) fail(code);
  return value;
}

function boundedText(value, maxChars, code, { multiline = false } = {}) {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxChars) fail(code);
  if (!(multiline ? MULTILINE_PATTERN : SINGLE_LINE_PATTERN).test(normalized)) fail(code);
  return normalized;
}

function optionalUuid(value, code) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(code);
  return value.toLowerCase();
}

function requiredUuid(value, code) {
  const result = optionalUuid(value, code);
  if (!result) fail(code);
  return result;
}

function booleanOrUndefined(value, code) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(code);
  return value;
}

export async function readAgentJsonRequest(request, maxBytes) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") fail("unsupported_media_type", 415);
  try {
    return await readBoundedJsonObject(request, maxBytes);
  } catch (error) {
    if (error instanceof BoundedJsonError) {
      fail(error.status === 413 ? "request_too_large" : "invalid_request_body", error.status);
    }
    fail("invalid_request_body");
  }
}

function parseTeamTask(value) {
  const task = strictRecord(
    value,
    new Set([
      "key",
      "role",
      "title",
      "instructions",
      "dependencies",
      "checkpoint",
      "reusableSubplan",
    ]),
    "invalid_agent_team",
  );
  if (typeof task.role !== "string" || !AGENT_ROLES.has(task.role)) fail("invalid_agent_team");
  if (!Array.isArray(task.dependencies) || task.dependencies.length > AGENT_TEAM_MAX_TASKS) {
    fail("invalid_agent_team");
  }
  const dependencies = task.dependencies.map((dependency) =>
    boundedText(dependency, 100, "invalid_agent_team"),
  );
  if (new Set(dependencies).size !== dependencies.length) fail("invalid_agent_team");
  const reusableSubplan =
    task.reusableSubplan === undefined
      ? undefined
      : boundedText(task.reusableSubplan, 2000, "invalid_agent_team", {
          multiline: true,
        });
  const checkpoint = booleanOrUndefined(task.checkpoint, "invalid_agent_team");
  return {
    key: boundedText(task.key, 100, "invalid_agent_team"),
    role: task.role,
    title: boundedText(task.title, 200, "invalid_agent_team"),
    instructions: boundedText(task.instructions, 8000, "invalid_agent_team", {
      multiline: true,
    }),
    dependencies,
    ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(reusableSubplan === undefined ? {} : { reusableSubplan }),
  };
}

export function parseAgentTeamCreatePayload(value) {
  const body = strictRecord(
    value,
    new Set(["objective", "projectId", "idempotencyKey", "tasks", "context"]),
    "invalid_agent_team",
  );
  if (
    !Array.isArray(body.tasks) ||
    body.tasks.length < 1 ||
    body.tasks.length > AGENT_TEAM_MAX_TASKS
  ) {
    fail("invalid_agent_team");
  }
  if (body.context !== undefined && !Array.isArray(body.context)) fail("invalid_agent_team");
  if ((body.context?.length ?? 0) > 30) fail("invalid_agent_team");
  const context = (body.context ?? []).map((item) =>
    boundedText(item, 4000, "invalid_agent_team", { multiline: true }),
  );
  return {
    objective: boundedText(body.objective, 4000, "invalid_agent_team", {
      multiline: true,
    }),
    projectId: optionalUuid(body.projectId, "invalid_agent_team"),
    idempotencyKey: boundedText(body.idempotencyKey, 120, "invalid_agent_team"),
    tasks: body.tasks.map(parseTeamTask),
    context,
  };
}

export function parseAgentRunControlPayload(value) {
  const body = strictRecord(
    value,
    new Set(["runId", "command", "approvalId"]),
    "invalid_control_request",
  );
  const commands = new Set(["pause", "resume", "cancel", "delete", "deny"]);
  if (typeof body.command !== "string" || !commands.has(body.command)) {
    fail("invalid_control_request");
  }
  const approvalId = optionalUuid(body.approvalId, "invalid_control_request");
  if ((body.command === "deny") !== Boolean(approvalId)) fail("invalid_control_request");
  return {
    runId: requiredUuid(body.runId, "invalid_control_request"),
    command: body.command,
    ...(approvalId ? { approvalId } : {}),
  };
}

export function parseAgentTeamControlPayload(value) {
  const body = strictRecord(
    value,
    new Set(["runId", "command", "taskId"]),
    "invalid_agent_control",
  );
  const commands = new Set(["pause", "resume", "cancel", "retry", "approve", "deny"]);
  if (typeof body.command !== "string" || !commands.has(body.command)) {
    fail("invalid_agent_control");
  }
  const taskId = optionalUuid(body.taskId, "invalid_agent_control");
  const taskCommand = body.command === "approve" || body.command === "deny";
  if (taskCommand !== Boolean(taskId)) fail("invalid_agent_control");
  return {
    runId: requiredUuid(body.runId, "invalid_agent_control"),
    command: body.command,
    ...(taskId ? { taskId } : {}),
  };
}

export function parseAgentRunQuery(searchParams) {
  if ([...searchParams.keys()].some((key) => key !== "runId")) fail("invalid_agent_run_id");
  const values = searchParams.getAll("runId");
  if (values.length > 1) fail("invalid_agent_run_id");
  return {
    runId: values.length ? requiredUuid(values[0], "invalid_agent_run_id") : undefined,
  };
}

export async function authorizeAgentProject({ supabaseUser, projectId }) {
  if (!projectId) return undefined;
  let result;
  try {
    result = await supabaseUser.from("projects").select("id").eq("id", projectId).maybeSingle();
  } catch {
    fail("agent_project_authorization_unavailable", 503);
  }
  if (result?.error) fail("agent_project_authorization_unavailable", 503);
  if (result?.data?.id !== projectId) fail("agent_project_forbidden", 403);
  return projectId;
}
