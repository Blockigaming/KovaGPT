import { fromJSON } from "seroval";

// Private presentation-only projection. No membership mutation is implemented.
export const PROJECT_MEMBER_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const PROJECT_MEMBER_REVIEW_ID = "33333333-3333-4333-8333-333333333333";
export const PROJECT_MEMBER_REVIEW_PROJECT_OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
export const PROJECT_MEMBER_REVIEW_OPTION = Object.freeze({
  id: "project-member-review",
  label: "project-member-review · read-only member actions / cancel Leave",
  accounts: Object.freeze(["free", "plus", "pro"]),
  path: "/projects/33333333-3333-4333-8333-333333333333",
});
export const PROJECT_MEMBER_REVIEW_DISCLOSURE =
  "project-member-review shows a read-only fictional viewer projection of the existing sample project, with a distinct synthetic owner. Its Leave confirmation may be opened and canceled; every server mutation, membership write, project upload and direct storage request is denied. No account role, membership, project content or real service is changed. The default and Archive / Restore scenarios retain their original owner data.";
const origin = "http://127.0.0.1:4189";
const projectReads = new Set([
  "listProjects",
  "getProject",
  "listMembers",
  "listInvites",
  "listProjectChats",
]);
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

function readData(request, url, name) {
  if (
    request.postData() ||
    [...url.searchParams.keys()].some((key) => key !== "payload") ||
    url.searchParams.getAll("payload").length > 1
  )
    throw new Error();
  const raw = url.searchParams.get("payload");
  if (name === "listProjects" && raw === null) return;
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > 8192) throw new Error();
  const envelope = fromJSON(JSON.parse(raw));
  if (
    !plain(envelope) ||
    Object.keys(envelope).some((key) => !["data", "context"].includes(key)) ||
    (envelope.context !== undefined &&
      (!plain(envelope.context) || Object.keys(envelope.context).length))
  )
    throw new Error();
  const data = envelope.data;
  if (name === "listProjects") {
    if (data !== undefined && (!plain(data) || Object.keys(data).length)) throw new Error();
    return;
  }
  const key = name === "getProject" ? "id" : "project_id";
  if (!plain(data) || Object.keys(data).length !== 1 || typeof data[key] !== "string")
    throw new Error();
  return data[key];
}

export function createProjectMemberReviewHandler(functionNames, { isActive, getProjects } = {}) {
  if (
    !(functionNames instanceof Map) ||
    typeof isActive !== "function" ||
    typeof getProjects !== "function"
  )
    throw new Error("Existing sample project, function manifest and active session required.");
  const names = new Map(functionNames);
  for (const name of [...projectReads, "leaveProject"])
    if (![...names.values()].some((value) => value.split("_")[0] === name))
      throw new Error(`Packaged member review contract is missing ${name}.`);
  const original = getProjects()?.find((row) => row.id === PROJECT_MEMBER_REVIEW_ID);
  if (
    isActive() !== true ||
    original?.owner_id !== PROJECT_MEMBER_REVIEW_OWNER ||
    original.role !== "owner" ||
    original.deletion_requested_at
  )
    throw new Error("The unchanged existing owner sample is required.");
  const project = {
    ...structuredClone(original),
    owner_id: PROJECT_MEMBER_REVIEW_PROJECT_OWNER,
    role: "viewer",
    member_count: 2,
  };
  const members = [
    {
      project_id: project.id,
      user_id: PROJECT_MEMBER_REVIEW_PROJECT_OWNER,
      email: "collaborator@example.invalid",
      role: "owner",
      created_at: project.created_at,
    },
    {
      project_id: project.id,
      user_id: PROJECT_MEMBER_REVIEW_OWNER,
      email: "review@example.invalid",
      role: "viewer",
      created_at: project.created_at,
    },
  ];
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const server = /^\/_serverFn\/[^/]+$/.test(url.pathname);
    const projectApi = /^\/api\/(?:project[^/]*|private-files)(?:\/|$)/.test(url.pathname);
    const backend =
      /^\/rest\/v1\/(?:projects|project_[^/]+|rpc\/[^/]*project[^/]*)$/.test(url.pathname) ||
      url.pathname.startsWith("/storage/v1/");
    if (!server && !projectApi && !backend) return route.fallback();
    const fail = (status, error) =>
      route.fulfill({ status, json: { error }, headers: { "Cache-Control": "no-store" } });
    if (!backend && url.origin !== origin) return fail(400, "Use the local member review origin.");
    const headers = request.headers();
    if (
      isActive() !== true ||
      (Object.hasOwn(headers, "x-kova-owner") &&
        headers["x-kova-owner"] !== PROJECT_MEMBER_REVIEW_OWNER)
    )
      return fail(401, "Synthetic member review account changed.");
    if (request.signal?.()?.aborted) return fail(499, "Synthetic member read canceled.");
    if (backend || method !== "GET")
      return fail(405, "Read-only member review; Leave and all project mutations are unavailable.");
    if (!server) return route.fallback();
    const name = (names.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0];
    if (!projectReads.has(name))
      return /^(?:get|list|search|is|can)[A-Z]/.test(name)
        ? route.fallback()
        : fail(405, "Only named reads are available in the synthetic member review.");
    let id;
    try {
      id = readData(request, url, name);
    } catch {
      return fail(400, "Use the exact bounded synthetic project read.");
    }
    if (name !== "listProjects" && id !== project.id)
      return fail(404, "Only the fixed synthetic member project is available.");
    const result =
      name === "listProjects"
        ? [project]
        : name === "getProject"
          ? project
          : name === "listMembers"
            ? members
            : [];
    return route.fulfill({
      status: 200,
      json: { result: structuredClone(result), context: {} },
      headers: { "Cache-Control": "no-store" },
    });
  };
}
