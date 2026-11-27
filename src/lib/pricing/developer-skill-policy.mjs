const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => {
  throw new Error("developer_skill_invalid");
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
  exact(value, ["name", "description", "instructions"]);
  return {
    name: text(value.name, 160).trim(),
    description: text(value.description, 512).trim(),
    instructions: text(value.instructions, 4000),
  };
}
export function parseDeveloperSkillRequest(method, params, body) {
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
  const skillId = params.get("id");
  const revision = params.get("version");
  if (method === "GET") {
    if (skillId === null) {
      if (revision !== null) fail();
      return { operation: "list", input: {} };
    }
    if (revision !== null && !/^(?:[1-9]|1[0-9]|20)$/.test(revision)) fail();
    return {
      operation: "get",
      input: { id: id(skillId), ...(revision !== null ? { version: Number(revision) } : {}) },
    };
  }
  if (method === "DELETE" && skillId !== null && revision === null)
    return { operation: "delete", input: { id: id(skillId) } };
  fail();
}
export function parseDeveloperSkillReferences(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) fail();
  const refs = value.map((ref) => {
    exact(ref, ["id", "version"]);
    return { id: id(ref.id), version: version(ref.version) };
  });
  if (new Set(refs.map((ref) => ref.id)).size !== refs.length) fail();
  return refs;
}

// Only exact, project-authorized stored skill versions contribute instructions.
// These are declarative text bundles: no executable code, credentials or tools.
export function expandDeveloperSkills(instructions, refs, saved) {
  if (!Array.isArray(refs) || !Array.isArray(saved) || refs.length !== saved.length) fail();
  if (!refs.length) return { instructions, bindings: [] };
  const bindings = [];
  const blocks = saved.map((row, index) => {
    const ref = refs[index];
    if (
      row?.id !== ref.id ||
      row.version !== ref.version ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at))
    )
      throw new Error("developer_skill_conflict");
    const config = definition(row.definition);
    bindings.push({ id: ref.id, version: ref.version, createdAt: row.created_at });
    return "Skill " + JSON.stringify(config.name) + ":\n" + config.instructions;
  });
  const combined = [instructions, ...blocks].join("\n\n");
  if (new TextEncoder().encode(combined).byteLength > 8000) fail();
  return { instructions: combined, bindings };
}
