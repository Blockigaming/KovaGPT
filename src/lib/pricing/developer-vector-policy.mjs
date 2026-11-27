const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modelPattern = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;
const entryPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const fail = () => {
  throw new Error("developer_vector_invalid");
};
function exact(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    fail();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  return value.toLowerCase();
}
function entry(value) {
  if (typeof value !== "string" || !entryPattern.test(value)) fail();
  return value;
}
function model(value) {
  if (typeof value !== "string" || value.length < 2 || value.length > 80 || !modelPattern.test(value))
    fail();
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}
export function developerVector(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 1536 ||
    value.some(
      (component) =>
        typeof component !== "number" ||
        !Number.isFinite(component) ||
        Math.abs(component) > 1e6 ||
        (component !== 0 && Math.abs(component) < 1e-12),
    ) ||
    !value.some((component) => Math.abs(component) >= 1e-9)
  )
    fail();
  return [...value];
}

export function parseDeveloperVectorRequest(method, params, body) {
  for (const key of params.keys())
    if (params.getAll(key).length !== 1) fail();
  if (method === "POST") {
    if ([...params.keys()].length) fail();
    const operation = body?.operation;
    if (operation === "create") {
      exact(body, ["operation", "name", "model", "dimensions"]);
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 80 ||
        body.name.includes("\0")
      )
        fail();
      return {
        operation,
        input: {
          name: body.name.trim(),
          model: model(body.model),
          dimensions: integer(body.dimensions, 1, 1536),
        },
      };
    }
    if (operation === "upsert") {
      exact(body, ["operation", "store_id", "entry_id", "model", "vector", "text", "file_id"]);
      if (
        typeof body.text !== "string" ||
        !body.text.trim() ||
        body.text.includes("\0") ||
        new TextEncoder().encode(body.text).length > 2048
      )
        fail();
      return {
        operation,
        input: {
          store_id: id(body.store_id),
          entry_id: entry(body.entry_id),
          model: model(body.model),
          vector: developerVector(body.vector),
          text: body.text,
          ...(body.file_id !== undefined ? { file_id: id(body.file_id) } : {}),
        },
      };
    }
    if (operation === "search") {
      exact(body, ["operation", "store_id", "model", "vector", "limit"]);
      return {
        operation,
        input: {
          store_id: id(body.store_id),
          model: model(body.model),
          vector: developerVector(body.vector),
          limit: integer(body.limit ?? 5, 1, 20),
        },
      };
    }
    fail();
  }
  if (method !== "GET" && method !== "DELETE") fail();
  for (const key of params.keys())
    if (!["id", "entry_id", "entries", "page"].includes(key)) fail();
  const store = params.get("id");
  const entryId = params.get("entry_id");
  if (method === "DELETE") {
    if (!store || params.has("entries") || params.has("page")) fail();
    return {
      operation: entryId === null ? "delete" : "delete_entry",
      input: { store_id: id(store), ...(entryId !== null ? { entry_id: entry(entryId) } : {}) },
    };
  }
  if (store === null) {
    if ([...params.keys()].length) fail();
    return { operation: "list", input: {} };
  }
  if (entryId !== null) {
    if (params.has("entries") || params.has("page")) fail();
    return { operation: "get_entry", input: { store_id: id(store), entry_id: entry(entryId) } };
  }
  if (params.has("entries")) {
    const raw = params.get("page") ?? "0";
    if (params.get("entries") !== "true" || !/^(0|[1-9][0-9]?)$/.test(raw)) fail();
    return {
      operation: "list_entries",
      input: { store_id: id(store), page: integer(Number(raw), 0, 19) },
    };
  }
  if (params.has("page")) fail();
  return { operation: "get", input: { store_id: id(store) } };
}
