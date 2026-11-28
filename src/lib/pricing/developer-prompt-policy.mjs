const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => {
  throw new Error("developer_prompt_invalid");
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
function version(value, maximum = 20) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail();
  return value;
}
function text(value, maximum) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    new TextEncoder().encode(value).byteLength > maximum
  )
    fail();
  return value;
}
function definition(value) {
  exact(value, ["name", "description", "prompt"]);
  return {
    name: text(value.name, 160).trim(),
    description: text(value.description, 512).trim(),
    prompt: text(value.prompt, 4000),
  };
}
export function parseDeveloperPromptRequest(method, params, body) {
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
        ...(update ? { expected_version: version(body.expected_version, 19) } : {}),
      },
    };
  }
  const promptId = params.get("id");
  const revision = params.get("version");
  if (method === "GET") {
    if (promptId === null) {
      if (revision !== null) fail();
      return { operation: "list", input: {} };
    }
    if (revision !== null && !/^(?:[1-9]|1[0-9]|20)$/.test(revision)) fail();
    return {
      operation: "get",
      input: { id: id(promptId), ...(revision !== null ? { version: Number(revision) } : {}) },
    };
  }
  if (method === "DELETE" && promptId !== null && revision === null)
    return { operation: "delete", input: { id: id(promptId) } };
  fail();
}
