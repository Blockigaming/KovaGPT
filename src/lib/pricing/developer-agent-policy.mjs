import { developerConversationReference } from "./developer-conversation-policy.mjs";
import { parseDeveloperSkillReferences } from "./developer-skill-policy.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => {
  throw new Error("developer_agent_invalid");
};
function exact(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  return value.toLowerCase();
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}
function text(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    new TextEncoder().encode(value).byteLength > max
  )
    fail();
  return value;
}
function definition(value) {
  exact(value, ["name", "model", "instructions", "max_output_tokens"]);
  if (
    typeof value.model !== "string" ||
    !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/.test(value.model) ||
    value.model.length < 2 ||
    value.model.length > 80
  )
    fail();
  return {
    name: text(value.name, 160).trim(),
    model: value.model,
    instructions: text(value.instructions, 8000),
    max_output_tokens: integer(value.max_output_tokens, 1, 8192),
  };
}
export function parseDeveloperAgentRequest(method, params, body) {
  for (const key of params.keys())
    if (!["id", "version"].includes(key) || params.getAll(key).length !== 1) fail();
  if (method === "POST") {
    if ([...params.keys()].length) fail();
    const update = body?.operation === "update";
    if (!update && body?.operation !== "create") fail();
    exact(body, ["operation", "id", "definition", ...(update ? ["expected_version"] : [])]);
    return {
      operation: body.operation,
      input: {
        id: id(body.id),
        definition: definition(body.definition),
        ...(update ? { expected_version: integer(body.expected_version, 1, 19) } : {}),
      },
    };
  }
  const agentId = params.get("id");
  const version = params.get("version");
  if (method === "GET") {
    if (agentId === null) {
      if (version !== null) fail();
      return { operation: "list", input: {} };
    }
    if (version !== null && !/^(?:[1-9]|1[0-9]|20)$/.test(version)) fail();
    return {
      operation: "get",
      input: { id: id(agentId), ...(version !== null ? { version: Number(version) } : {}) },
    };
  }
  if (method === "DELETE" && agentId !== null && version === null)
    return { operation: "delete", input: { id: id(agentId) } };
  fail();
}
export function parseDeveloperAgentTurn(value) {
  exact(value, [
    "agent_id",
    "version",
    "input",
    ...(value?.skills === undefined ? [] : ["skills"]),
    ...(value?.conversation === undefined ? [] : ["conversation"]),
  ]);
  let conversation;
  if (value.conversation !== undefined) {
    try {
      conversation = developerConversationReference("responses", {
        input: value.input,
        conversation: value.conversation,
      }).reference;
    } catch {
      fail();
    }
  }
  return {
    agent_id: id(value.agent_id),
    version: integer(value.version, 1, 20),
    input: text(value.input, 16000),
    ...(value.skills === undefined ? {} : { skills: parseDeveloperSkillReferences(value.skills) }),
    ...(conversation ? { conversation } : {}),
  };
}
// Only the authenticated, immutable definition determines the provider request.
export function expandDeveloperAgentTurn(turn, saved) {
  if (saved?.id !== turn.agent_id || saved.version !== turn.version)
    throw new Error("developer_agent_conflict");
  const config = definition(saved.definition);
  return {
    model: config.model,
    instructions: config.instructions,
    input: turn.input,
    max_output_tokens: config.max_output_tokens,
    stream: false,
    ...(turn.conversation ? { conversation: turn.conversation } : {}),
  };
}
