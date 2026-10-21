import { fromJSON } from "seroval";

// Private local review only. The one existing CRUD project is never replaced.
export const PROJECT_ARCHIVE_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const PROJECT_ARCHIVE_REVIEW_ID = "33333333-3333-4333-8333-333333333333";
export const PROJECT_ARCHIVE_REVIEW_TIME = "2026-10-19T00:00:00.000Z";
export const PROJECT_ARCHIVE_REVIEW_OPTION = Object.freeze({
  id: "project-archive-review",
  label: "project-archive-review · archive / restore existing sample only",
  accounts: Object.freeze(["free", "plus", "pro"]),
  path: "/projects",
});
export const PROJECT_ARCHIVE_REVIEW_DISCLOSURE =
  "project-archive-review changes only archived_at on the existing synthetic Review project. Archive sets a fixed sample timestamp; Restore clears it. List and detail keep the same project ID, owner, instructions, counts and other fields. Existing chat, file and Context read fixtures are unchanged; no new chat, file or activity record is invented. Other project writes, membership changes, uploads and provider suggestions are blocked in this scenario. Changes last only in this disposable session and reset restores the original sample. No real project, account, backend or provider is contacted.";
const origin = "http://127.0.0.1:4189";
const blocked = new Set([
  "createProject",
  "updateProject",
  "deleteProject",
  "pinProject",
  "duplicateProject",
  "saveProjectNote",
  "createTask",
  "updateTask",
  "reorderTasks",
  "deleteTask",
  "reindexProjectFile",
  "addMemory",
  "deleteMemory",
  "importChatToProject",
  "moveChatToProject",
  "removeMember",
  "leaveProject",
  "updateMemberRole",
  "inviteMember",
  "revokeInvite",
  "acceptInvite",
  "declineInvite",
  "createProjectChat",
  "saveProjectChat",
  "deleteProjectChat",
]);
const reads = new Set(["listProjects", "getProject"]);
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function payload(request, url, name) {
  const method = request.method();
  if (
    [...url.searchParams.keys()].some((key) => method !== "GET" || key !== "payload") ||
    url.searchParams.getAll("payload").length > 1 ||
    (method === "GET" && request.postData())
  )
    throw new Error();
  const raw = method === "GET" ? url.searchParams.get("payload") : request.postData();
  if (raw === null && name === "listProjects" && !url.searchParams.has("payload")) return undefined;
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > 8192) throw new Error();
  const value = fromJSON(JSON.parse(raw));
  if (
    !plain(value) ||
    Object.keys(value).some((key) => !["data", "context"].includes(key)) ||
    (value.context !== undefined && (!plain(value.context) || Object.keys(value.context).length))
  )
    throw new Error();
  const data = value.data;
  if (name === "listProjects") {
    if (data !== undefined && (!plain(data) || Object.keys(data).length)) throw new Error();
  } else if (
    !plain(data) ||
    typeof data.id !== "string" ||
    Object.keys(data).length !== (name === "setProjectArchived" ? 2 : 1) ||
    Object.keys(data).some(
      (key) => !(name === "setProjectArchived" ? ["id", "archived"] : ["id"]).includes(key),
    ) ||
    (name === "setProjectArchived" && typeof data.archived !== "boolean")
  )
    throw new Error();
  return data;
}
export function createProjectArchiveReviewHandler(functionNames, { isActive, getProjects } = {}) {
  if (
    !(functionNames instanceof Map) ||
    typeof isActive !== "function" ||
    typeof getProjects !== "function"
  )
    throw new Error("Existing synthetic project state, manifest and active session required.");
  const names = new Map(functionNames);
  for (const required of ["setProjectArchived", ...reads])
    if (![...names.values()].some((value) => value.split("_")[0] === required))
      throw new Error(`Packaged project archive contract is missing ${required}.`);
  const current = () => {
    const rows = getProjects();
    return Array.isArray(rows) ? rows.find((row) => row.id === PROJECT_ARCHIVE_REVIEW_ID) : null;
  };
  const owned = (project) =>
    project?.owner_id === PROJECT_ARCHIVE_REVIEW_OWNER &&
    project.role === "owner" &&
    !project.deletion_requested_at;
  if (isActive() !== true || !owned(current()))
    throw new Error("The existing synthetic Review project owner is required.");
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const name = /^\/_serverFn\/[^/]+$/.test(url.pathname)
      ? (names.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    const apiWrite =
      ["/api/project-files", "/api/project-suggest", "/api/project-templates"].includes(
        url.pathname,
      ) && request.method() !== "GET";
    if (!reads.has(name) && name !== "setProjectArchived" && !blocked.has(name) && !apiWrite)
      return route.fallback();
    const error = (status, body) =>
      route.fulfill({
        status,
        contentType: "text/plain",
        headers: { "Cache-Control": "no-store" },
        body,
      });
    const headers = request.headers();
    if (
      isActive() !== true ||
      (Object.hasOwn(headers, "x-kova-owner") &&
        headers["x-kova-owner"] !== PROJECT_ARCHIVE_REVIEW_OWNER)
    )
      return error(401, "Synthetic project archive account does not match.");
    if (blocked.has(name) || apiWrite)
      return error(
        503,
        "Only Archive / Restore of the existing sample project is writable in this review.",
      );
    if (request.method() !== (reads.has(name) ? "GET" : "POST"))
      return error(405, "Unsupported synthetic project archive method.");
    if (request.signal?.()?.aborted)
      return error(499, "Synthetic project archive request canceled.");
    let data;
    try {
      data = payload(request, url, name);
    } catch {
      return error(400, "Use the exact bounded project archive/read payload.");
    }
    if (name !== "listProjects" && data.id !== PROJECT_ARCHIVE_REVIEW_ID)
      return error(404, "Only the existing synthetic Review project is available.");
    const project = current();
    if (!owned(project))
      return error(403, "The existing synthetic project owner is no longer available.");
    if (name === "setProjectArchived")
      project.archived_at = data.archived ? PROJECT_ARCHIVE_REVIEW_TIME : null;
    return route.fulfill({
      status: 200,
      headers: { "Cache-Control": "no-store" },
      json: {
        result: structuredClone(
          name === "setProjectArchived"
            ? { ok: true }
            : name === "listProjects"
              ? [project]
              : project,
        ),
        context: {},
      },
    });
  };
}
