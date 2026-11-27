const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => {
  throw new Error("developer_conversation_invalid");
};
const roles = ["user", "assistant", "developer", "system"];
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) fail();
  return value.toLowerCase();
}
function text(value, maximum) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > maximum
  )
    fail();
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 200) fail();
  return value;
}
export function parseDeveloperConversationRequest(method, params, body) {
  for (const key of params.keys())
    if (!["id", "item_id"].includes(key) || params.getAll(key).length !== 1) fail();
  if (method === "POST") {
    if ([...params.keys()].length) fail();
    if (body?.operation === "create") {
      exact(body, ["operation", "id", "title"]);
      return {
        operation: "create",
        input: { id: id(body.id), title: text(body.title, 160).trim() },
      };
    }
    if (body?.operation === "append") {
      exact(body, ["operation", "id", "expected_revision", "item"]);
      exact(body.item, ["id", "role", "content"]);
      if (!roles.includes(body.item.role)) fail();
      return {
        operation: "append",
        input: {
          id: id(body.id),
          expected_revision: revision(body.expected_revision),
          item: {
            id: id(body.item.id),
            role: body.item.role,
            content: text(body.item.content, 8192),
          },
        },
      };
    }
    if (body?.operation === "remove") {
      exact(body, ["operation", "id", "expected_revision", "item_id"]);
      return {
        operation: "remove",
        input: {
          id: id(body.id),
          expected_revision: revision(body.expected_revision),
          item_id: id(body.item_id),
        },
      };
    }
    fail();
  }
  if (method !== "GET" && method !== "DELETE") fail();
  const conversation = params.get("id");
  const item = params.get("item_id");
  if (conversation === null) {
    if (method !== "GET" || item !== null) fail();
    return { operation: "list", input: {} };
  }
  if (method === "DELETE") {
    if (item !== null) fail();
    return { operation: "delete", input: { id: id(conversation) } };
  }
  return item === null
    ? { operation: "get", input: { id: id(conversation) } }
    : { operation: "get_item", input: { id: id(conversation), item_id: id(item) } };
}

// Stored history is read from the existing scoped conversation resource, never from client data.
export function developerConversationReference(kind, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  if (!Object.hasOwn(input, "conversation")) return { body: input, reference: null };
  if (kind !== "responses") fail();
  const { conversation, ...body } = input;
  exact(conversation, ["id", "revision"]);
  if (typeof body.input !== "string") fail();
  text(body.input, 32000);
  return {
    body,
    reference: { id: id(conversation.id), revision: revision(conversation.revision) },
  };
}
export function expandDeveloperConversation(reference, body, saved, projectId, now = Date.now()) {
  if (
    saved?.id !== reference.id ||
    saved.project_id !== projectId ||
    saved.revision !== reference.revision ||
    !Number.isFinite(Date.parse(saved.created_at)) ||
    !Number.isFinite(Date.parse(saved.expires_at)) ||
    Date.parse(saved.expires_at) <= now ||
    !Array.isArray(saved.items) ||
    saved.items.length > 99
  )
    throw new Error("developer_conversation_conflict");
  const seen = new Set();
  const messages = saved.items.map((item) => {
    exact(item, ["id", "role", "content"]);
    const itemId = id(item.id);
    if (seen.has(itemId) || !roles.includes(item.role)) fail();
    seen.add(itemId);
    return { role: item.role, content: text(item.content, 8192) };
  });
  messages.push({ role: "user", content: text(body.input, 32000) });
  const expanded = { ...body, input: messages };
  if (new TextEncoder().encode(JSON.stringify(expanded)).byteLength > 65536)
    throw new Error("developer_input_too_large");
  return {
    body: expanded,
    binding: { id: reference.id, revision: reference.revision, createdAt: saved.created_at },
    expiresAt: Date.parse(saved.expires_at),
  };
}
