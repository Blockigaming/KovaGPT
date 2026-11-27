const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entryId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const keyPattern = /^kova_([0-9a-f-]{36})_[A-Za-z0-9_-]{43}$/;
const get = (label, fields = {}) => ({ label, method: "GET", fields });
const post = (label, operation, fields) => ({ label, method: "POST", fields, operation });
const remove = { label: "Delete resource", method: "DELETE", fields: { id: "" } };
const list = get("List resources");
const detail = get("Retrieve resource", { id: "" });
const version = get("Retrieve version", { id: "", version: 1 });
const agent = { name: "", model: "", instructions: "", max_output_tokens: 256 };
const skill = { name: "", description: "", instructions: "" };
const item = get("Retrieve item", { id: "", item_id: "" });
const cancel = post("Cancel queued items", "cancel", { id: "" });

export const developerResourceSections = Object.freeze({
  agents: {
    label: "Agents",
    description: "Manage immutable versions of agent definitions.",
    actions: {
      list,
      detail,
      version,
      create: post("Create agent", "create", { id: "", definition: agent }),
      update: post("Create new version", "update", {
        id: "",
        expected_version: 1,
        definition: agent,
      }),
      delete: remove,
    },
  },
  skills: {
    label: "Skills",
    description: "Manage versioned, reusable instruction bundles.",
    actions: {
      list,
      detail,
      version,
      create: post("Create skill", "create", { id: "", definition: skill }),
      update: post("Create new version", "update", {
        id: "",
        expected_version: 1,
        definition: skill,
      }),
      delete: remove,
    },
  },
  conversations: {
    label: "Conversations",
    description: "Inspect and manage private, revisioned conversation history.",
    actions: {
      list,
      detail,
      item,
      create: post("Create conversation", "create", { id: "", title: "" }),
      append: post("Append message", "append", {
        id: "",
        expected_revision: 0,
        item: { id: "", role: "user", content: "" },
      }),
      remove: post("Remove message", "remove", { id: "", expected_revision: 0, item_id: "" }),
      delete: remove,
    },
  },
  "vector-stores": {
    label: "Vector stores",
    description:
      "Manage project-owned vectors. Supply your own embeddings for indexing and search.",
    actions: {
      list,
      detail,
      entries: get("List entries", { id: "", entries: "true", page: 0 }),
      entry: get("Retrieve entry", { id: "", entry_id: "" }),
      create: post("Create store", "create", { name: "", model: "", dimensions: 1 }),
      upsert: post("Upsert entry", "upsert", {
        store_id: "",
        entry_id: "",
        model: "",
        vector: [1],
        text: "",
      }),
      search: post("Search vectors", "search", { store_id: "", model: "", vector: [1], limit: 5 }),
      deleteEntry: { label: "Delete entry", method: "DELETE", fields: { id: "", entry_id: "" } },
      delete: remove,
    },
  },
  batches: {
    label: "Batches",
    description:
      "Inspect jobs and cancel remaining queued items. Submit new jobs through the SDK with signed quotes and a budget.",
    actions: { list, detail, item, cancel },
  },
  automations: {
    label: "Automations",
    description:
      "Inspect, pause, resume or cancel schedules. Resuming may run already authorized paid items.",
    actions: {
      list,
      detail,
      item,
      pause: post("Pause schedule", "pause", { id: "" }),
      resume: post("Resume schedule", "resume", { id: "" }),
      cancel,
    },
  },
  webhooks: {
    label: "Webhooks",
    description: "Manage approved HTTPS endpoints, signing secrets and delivery history.",
    actions: {
      list,
      detail,
      deliveries: get("List deliveries", { id: "", deliveries: "true" }),
      create: post("Create endpoint", "create", {
        id: "",
        url: "",
        events: ["request.settled", "request.rejected"],
      }),
      rotate: post("Rotate signing secret", "rotate", { id: "", expected_generation: 1 }),
      test: post("Queue test event", "test", { id: "", event_id: "" }),
      delete: remove,
    },
  },
});

function descriptor(section, action) {
  if (!Object.hasOwn(developerResourceSections, section)) throw new Error("Unknown resource.");
  const actions = developerResourceSections[section].actions;
  if (!Object.hasOwn(actions, action)) throw new Error("Unknown operation.");
  return actions[action];
}

export function resourceConsoleTemplate(section, action, randomId) {
  const { fields, operation } = descriptor(section, action);
  const value = JSON.parse(JSON.stringify(fields));
  if (operation === "create" && Object.hasOwn(value, "id")) value.id = randomId();
  if (operation === "append") value.item.id = randomId();
  if (operation === "test") value.event_id = randomId();
  return JSON.stringify(value, null, 2);
}

export function resourceConsoleKey(value, allowed) {
  if (typeof value !== "string" || !Array.isArray(allowed)) return null;
  const token = value.trim();
  const match = keyPattern.exec(token);
  return match && uuid.test(match[1]) && allowed.includes(match[1]) ? token : null;
}

export function resourceConsoleRequest(section, action, raw) {
  const config = descriptor(section, action);
  if (
    typeof raw !== "string" ||
    raw.length > 60000 ||
    encodeURIComponent(raw).replace(/%[0-9A-F]{2}/g, "x").length > 60000
  )
    throw new Error("Request is too large.");
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("Enter valid JSON.");
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== Object.keys(config.fields).length ||
    Object.keys(input).some((key) => !Object.hasOwn(config.fields, key))
  )
    throw new Error("Use exactly the fields in the request template.");
  let path = "/api/v1/" + section;
  if (config.method === "POST") {
    const body = JSON.stringify({ operation: config.operation, ...input });
    return { method: config.method, path, body };
  }
  const query = [];
  for (const [key, value] of Object.entries(input)) {
    if (
      ((key === "id" || key === "item_id") && (typeof value !== "string" || !uuid.test(value))) ||
      (key === "entry_id" && (typeof value !== "string" || !entryId.test(value))) ||
      (key === "version" && (!Number.isInteger(value) || value < 1 || value > 20)) ||
      (key === "page" && (!Number.isInteger(value) || value < 0 || value > 19)) ||
      ((key === "deliveries" || key === "entries") && value !== "true")
    )
      throw new Error("Invalid resource identifier or query.");
    query.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
  }
  if (query.length) path += "?" + query.join("&");
  return { method: config.method, path };
}

export function resourceConsoleRequiresConfirmation(section, action) {
  const { method, operation } = descriptor(section, action);
  return method !== "GET" && operation !== "search";
}
