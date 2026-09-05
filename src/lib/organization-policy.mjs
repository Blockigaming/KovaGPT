export const ORGANIZATION_MAX_BODY_BYTES = 16_384;
export const ORGANIZATION_PAGE_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROLES = new Set(["owner", "admin", "member"]);
export class OrganizationInputError extends Error {
  constructor(code = "organization_request_invalid") {
    super(code);
    this.code = code;
  }
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new OrganizationInputError();
  return value.toLowerCase();
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new OrganizationInputError();
  return value;
}
function string(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new OrganizationInputError();
  return value.trim();
}
export function normalizeOrganizationDomain(value) {
  const domain = string(value, 253).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(domain))
    throw new OrganizationInputError("organization_domain_invalid");
  return domain;
}
export function organizationAvailability(env = {}) {
  const configured =
    env.KOVA_ORGANIZATION_ADMIN_ENABLED === "true" &&
    typeof env.KOVA_ORGANIZATION_POLICY_VERSION === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(env.KOVA_ORGANIZATION_POLICY_VERSION);
  return {
    available: configured,
    canClose: configured && env.KOVA_ORGANIZATION_CLOSURE_ENABLED === "true",
    retentionEnforced: false,
  };
}
export function parseOrganizationMutation(value) {
  if (!record(value)) throw new OrganizationInputError();
  const allowed = new Set([
    "action",
    "organizationId",
    "expectedRevision",
    "mutationId",
    "payload",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || !record(value.payload))
    throw new OrganizationInputError();
  const result = {
    action: value.action,
    organizationId: uuid(value.organizationId),
    expectedRevision: integer(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER),
    mutationId: uuid(value.mutationId),
    payload: {},
  };
  const input = value.payload;
  const select = (...keys) => {
    if (Object.keys(input).some((key) => !keys.includes(key))) throw new OrganizationInputError();
  };
  if (value.action === "create" || value.action === "rename") {
    select("name");
    result.payload = { name: string(input.name, 100) };
  } else if (value.action === "invite") {
    select("email", "role");
    const email = string(input.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || !ROLES.has(input.role))
      throw new OrganizationInputError();
    result.payload = { email, role: input.role };
  } else if (["acceptInvite", "declineInvite", "revokeInvite"].includes(value.action)) {
    select("invitationId");
    result.payload = { invitationId: uuid(input.invitationId) };
  } else if (value.action === "setRole") {
    select("userId", "role");
    if (!ROLES.has(input.role)) throw new OrganizationInputError();
    result.payload = { userId: uuid(input.userId), role: input.role };
  } else if (value.action === "removeMember") {
    select("userId");
    result.payload = { userId: uuid(input.userId) };
  } else if (value.action === "leave") {
    select();
  } else if (value.action === "claimDomain") {
    select("domain");
    result.payload = { domain: normalizeOrganizationDomain(input.domain) };
  } else if (["verifyDomain", "revokeDomain", "configureSso"].includes(value.action)) {
    select("domainId");
    result.payload = { domainId: uuid(input.domainId) };
  } else if (value.action === "disableSso") {
    select();
  } else if (value.action === "saveRetentionDraft") {
    select("days");
    result.payload = { days: integer(input.days, 1, 3650) };
  } else if (value.action === "close") {
    select("confirmation");
    result.payload = { confirmation: string(input.confirmation, 100) };
  } else throw new OrganizationInputError();
  if ((value.action === "create") !== (result.expectedRevision === 0))
    throw new OrganizationInputError();
  return result;
}
export function parseOrganizationQuery(url) {
  const params = new URL(url).searchParams;
  if (
    [...params.keys()].some(
      (key) => !["organizationId", "view", "cursor", "through", "limit"].includes(key),
    )
  )
    throw new OrganizationInputError();
  const view = params.get("view") ?? "workspace";
  if (!["workspace", "audit"].includes(view)) throw new OrganizationInputError();
  const number = (key, fallback) => (params.has(key) ? Number(params.get(key)) : fallback);
  const organizationId = params.has("organizationId") ? uuid(params.get("organizationId")) : null;
  if (view === "audit" && !organizationId) throw new OrganizationInputError();
  const cursor = integer(number("cursor", 0), 0, Number.MAX_SAFE_INTEGER);
  const through = params.has("through")
    ? integer(number("through", 0), cursor, Number.MAX_SAFE_INTEGER)
    : null;
  if (cursor && through === null) throw new OrganizationInputError();
  return {
    organizationId,
    view,
    cursor,
    through,
    limit: integer(number("limit", 100), 1, ORGANIZATION_PAGE_LIMIT),
  };
}
