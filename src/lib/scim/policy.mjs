export const SCIM_SCHEMA = Object.freeze({
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
});
export class ScimError extends Error {
  constructor(status, code = "invalidValue") {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
export function scimUuid(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value)
  )
    throw new ScimError(400);
  return value.toLowerCase();
}
function text(value, max, empty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new ScimError(400);
  return value.trim();
}
const known = (value, keys) => {
  if (!record(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new ScimError(400);
};
function memberList(value) {
  if (!Array.isArray(value) || value.length > 100) throw new ScimError(400, "tooMany");
  const ids = value.map((row) => {
    known(row, ["value", "display", "$ref"]);
    return scimUuid(row.value);
  });
  if (new Set(ids).size !== ids.length) throw new ScimError(400);
  return ids.map((value) => ({ value }));
}
export function parseScimResource(kind, input) {
  if (kind === "Users") {
    known(input, [
      "schemas",
      "id",
      "meta",
      "externalId",
      "userName",
      "displayName",
      "active",
      "emails",
    ]);
    if (
      !Array.isArray(input.schemas) ||
      input.schemas.length !== 1 ||
      input.schemas[0] !== SCIM_SCHEMA.user
    )
      throw new ScimError(400);
    const userName = text(input.userName, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(userName)) throw new ScimError(400);
    if (
      input.emails !== undefined &&
      (!Array.isArray(input.emails) ||
        input.emails.length !== 1 ||
        !record(input.emails[0]) ||
        typeof input.emails[0].value !== "string" ||
        input.emails[0].value.toLowerCase() !== userName)
    )
      throw new ScimError(400);
    if (input.active !== undefined && typeof input.active !== "boolean") throw new ScimError(400);
    return {
      externalId: text(input.externalId, 250),
      userName,
      displayName: text(input.displayName ?? "", 100, true),
      active: input.active ?? true,
    };
  }
  if (kind !== "Groups") throw new ScimError(404);
  known(input, ["schemas", "id", "meta", "externalId", "displayName", "members"]);
  if (
    !Array.isArray(input.schemas) ||
    input.schemas.length !== 1 ||
    input.schemas[0] !== SCIM_SCHEMA.group
  )
    throw new ScimError(400);
  return {
    externalId: text(input.externalId, 250),
    displayName: text(input.displayName, 100),
    members: memberList(input.members ?? []),
  };
}
export function scimIfMatch(value) {
  const match = /^W\/"([1-9][0-9]{0,14})"$/u.exec(value ?? "");
  if (!match) throw new ScimError(value ? 400 : 428, "invalidVers");
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision)) throw new ScimError(400);
  return revision;
}
export function parseScimQuery(url, kind) {
  const query = new URL(url).searchParams;
  if (
    [...query.keys()].some((key) => !["startIndex", "count", "filter"].includes(key)) ||
    [...new Set(query.keys())].some((key) => query.getAll(key).length !== 1)
  )
    throw new ScimError(400, "invalidFilter");
  const startIndex = Number(query.get("startIndex") ?? 1),
    count = Number(query.get("count") ?? 100);
  if (
    !Number.isSafeInteger(startIndex) ||
    startIndex < 1 ||
    startIndex > 10001 ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 100
  )
    throw new ScimError(400, "tooMany");
  let filter = null;
  if (query.has("filter")) {
    const match = /^(userName|externalId|displayName) eq ("(?:[^"\\]|\\["\\])*")$/u.exec(
      query.get("filter"),
    );
    if (
      !match ||
      (kind === "Groups" && match[1] === "userName") ||
      (kind === "Users" && match[1] === "displayName")
    )
      throw new ScimError(400, "invalidFilter");
    filter = { field: match[1], value: text(JSON.parse(match[2]), 254) };
  }
  return { startIndex, count, filter };
}
export function applyScimPatch(kind, current, input) {
  known(input, ["schemas", "Operations"]);
  if (
    !Array.isArray(input.schemas) ||
    input.schemas.length !== 1 ||
    input.schemas[0] !== SCIM_SCHEMA.patch ||
    !Array.isArray(input.Operations) ||
    input.Operations.length < 1 ||
    input.Operations.length > 20
  )
    throw new ScimError(400);
  const next = structuredClone(current);
  delete next.meta;
  delete next.id;
  delete next.emails;
  for (const op of input.Operations) {
    known(op, ["op", "path", "value"]);
    const operation = String(op.op).toLowerCase();
    if (!["add", "replace", "remove"].includes(operation)) throw new ScimError(400);
    const allowed =
      kind === "Users" ? ["userName", "displayName", "active"] : ["displayName", "members"];
    if (op.path === undefined) {
      if (
        operation === "remove" ||
        !record(op.value) ||
        Object.keys(op.value).some((key) => !allowed.includes(key))
      )
        throw new ScimError(400, "invalidPath");
      Object.assign(next, op.value);
      continue;
    }
    if (typeof op.path !== "string") throw new ScimError(400, "invalidPath");
    const member = /^members\[value eq "([a-f0-9-]{36})"\]$/iu.exec(op.path);
    if (member && kind === "Groups" && operation === "remove") {
      const id = scimUuid(member[1]);
      next.members = (next.members ?? []).filter((row) => row.value !== id);
      continue;
    }
    if (!allowed.includes(op.path)) throw new ScimError(400, "mutability");
    if (op.path === "members") {
      if (operation === "remove" && op.value === undefined) next.members = [];
      else {
        const list = memberList(op.value),
          old = memberList(next.members ?? []);
        next.members =
          operation === "replace"
            ? list
            : operation === "add"
              ? [...new Map([...old, ...list].map((row) => [row.value, row])).values()]
              : old.filter((row) => !list.some((drop) => drop.value === row.value));
      }
    } else if (operation === "remove") {
      if (op.path !== "displayName") throw new ScimError(400, "mutability");
      next.displayName = "";
    } else next[op.path] = op.value;
  }
  return parseScimResource(kind, next);
}
export function scimDocument(kind, row, base) {
  const common = {
    schemas: [kind === "Users" ? SCIM_SCHEMA.user : SCIM_SCHEMA.group],
    id: row.id,
    externalId: row.external_id,
    displayName: row.display_name,
    meta: {
      resourceType: kind === "Users" ? "User" : "Group",
      created: row.created_at,
      lastModified: row.updated_at,
      version: `W/"${row.revision}"`,
      location: `${base}/${kind}/${row.id}`,
    },
  };
  return kind === "Users"
    ? {
        ...common,
        userName: row.user_name,
        active: row.active,
        emails: [{ value: row.user_name, primary: true }],
      }
    : { ...common, members: (row.members ?? []).map((value) => ({ value })) };
}
export function scimConfiguration() {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: true },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Organization provisioning token",
        description: "Owner-approved tenant token; conditional writes require If-Match.",
        primary: true,
      },
    ],
  };
}

export function scimDiscovery(name, id) {
  const resourceTypes = [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: SCIM_SCHEMA.user,
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: SCIM_SCHEMA.group,
    },
  ];
  const attribute = (name, type = "string", required = false, extra = {}) => ({
    name,
    type,
    multiValued: false,
    required,
    caseExact: false,
    mutability: "readWrite",
    returned: "default",
    uniqueness: "none",
    ...extra,
  });
  const schemas = [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      id: SCIM_SCHEMA.user,
      name: "User",
      description:
        "Supported member directory attributes; externalId must match the configured SSO subject.",
      attributes: [
        attribute("userName", "string", true, { uniqueness: "server" }),
        attribute("displayName"),
        attribute("active", "boolean"),
        attribute("emails", "complex", false, {
          multiValued: true,
          subAttributes: [attribute("value"), attribute("primary", "boolean")],
        }),
      ],
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      id: SCIM_SCHEMA.group,
      name: "Group",
      description:
        "Directory group records; membership does not grant Project or administrator access.",
      attributes: [
        attribute("displayName", "string", true),
        attribute("members", "complex", false, {
          multiValued: true,
          subAttributes: [attribute("value", "string", true)],
        }),
      ],
    },
  ];
  const rows = name === "Schemas" ? schemas : resourceTypes;
  if (id) {
    const value = rows.find((row) => row.id === id);
    if (!value) throw new ScimError(404);
    return value;
  }
  return {
    schemas: [SCIM_SCHEMA.list],
    totalResults: rows.length,
    startIndex: 1,
    itemsPerPage: rows.length,
    Resources: rows,
  };
}
