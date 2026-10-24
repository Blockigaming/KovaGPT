import { fromJSON } from "seroval";

// Private review only. The adapter supplies its disposable CRUD project state;
// no database, browser driver, provider, or production module is imported here.
export const PROJECT_MOVE_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const PROJECT_MOVE_REVIEW_SOURCE_ID = "33333333-3333-4333-8333-333333333333";
export const PROJECT_MOVE_REVIEW_DESTINATION_ID = "33333333-3333-4333-8333-333333333334";
export const PROJECT_MOVE_REVIEW_CHAT_ID = "abababab-abab-4bab-8bab-abababababab";
export const PROJECT_MOVE_REVIEW_DISCLOSURE =
  "Project Move review adds one sample chat and one sample destination to this disposable session. Move changes only that sample chat's project. Existing project instructions and files keep their local fixtures. Reset discards all changes; no account project, backend, or provider is contacted.";

const origin = "http://127.0.0.1:4189";
const projectIds = new Set([PROJECT_MOVE_REVIEW_SOURCE_ID, PROJECT_MOVE_REVIEW_DESTINATION_ID]);
const functions = new Set(["listProjectChats", "getProjectChat", "moveChatToProject"]);
const fields = {
  listProjectChats: ["project_id"],
  getProjectChat: ["id"],
  moveChatToProject: ["chat_id", "project_id"],
};
const sampleTime = "2026-10-16T10:00:00.000Z";
const plainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Install only for the explicit signed-in project-move-review scenario.
 * getProjects must read the current CRUD array: deleteProject replaces it.
 * The three handled functions use the existing production payloads and DTOs.
 */
export function createProjectMoveReviewHandler(functionNames, { isActive, getProjects }) {
  if (typeof isActive !== "function" || typeof getProjects !== "function")
    throw new Error("Project Move review requires its active session and existing project state.");
  for (const name of functions)
    if (![...functionNames.values()].some((value) => value.split("_")[0] === name))
      throw new Error(`The packaged Project Move contract is missing ${name}.`);
  const projects = getProjects();
  const source = Array.isArray(projects)
    ? projects.find((project) => project.id === PROJECT_MOVE_REVIEW_SOURCE_ID)
    : null;
  if (
    isActive() !== true ||
    !source ||
    source.owner_id !== PROJECT_MOVE_REVIEW_OWNER ||
    source.role !== "owner" ||
    source.deletion_requested_at
  )
    throw new Error("Project Move review requires the existing active synthetic project owner.");
  if (projects.some((project) => project.id === PROJECT_MOVE_REVIEW_DESTINATION_ID))
    throw new Error("The synthetic Project Move destination already exists. Reset the review.");

  // Preserve the authoritative source project's fields and reuse the ordinary
  // CRUD handlers for list/get/update/Context, including destination inspection.
  projects.push({
    ...structuredClone(source),
    id: PROJECT_MOVE_REVIEW_DESTINATION_ID,
    name: "Sample move destination",
    description: "Synthetic destination for local Project Move review. Reset discards changes.",
    system_prompt: "Synthetic destination instructions. Use only this project's supplied material.",
    member_count: 1,
    chat_count: 0,
    file_count: 0,
    pinned_at: null,
    archived_at: null,
    deletion_requested_at: null,
  });
  const chat = {
    id: PROJECT_MOVE_REVIEW_CHAT_ID,
    project_id: PROJECT_MOVE_REVIEW_SOURCE_ID,
    title: "Sample project chat · move review",
    updated_at: sampleTime,
    created_by: PROJECT_MOVE_REVIEW_OWNER,
    snapshot: {
      messages: [
        {
          role: "user",
          content: "Review moving this synthetic chat between the two sample projects.",
        },
        {
          role: "assistant",
          content:
            "Sample only. The Move control changes this disposable chat's project; no live conversation is moved and no generation runs.",
        },
      ],
    },
  };
  let moves = 0;
  const currentProject = (id) => {
    const current = getProjects();
    if (!projectIds.has(id) || !Array.isArray(current)) return null;
    const project = current.find((candidate) => candidate.id === id);
    return project &&
      project.owner_id === PROJECT_MOVE_REVIEW_OWNER &&
      ["owner", "editor", "viewer"].includes(project.role) &&
      !project.deletion_requested_at
      ? project
      : null;
  };
  const syncCounts = () => {
    for (const id of projectIds) {
      const project = currentProject(id);
      if (project) project.chat_count = Number(chat.project_id === id);
    }
  };
  syncCounts();

  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name =
      url.origin === origin && /^\/_serverFn\/[^/]+$/.test(url.pathname)
        ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
        : "";
    if (!functions.has(name)) return route.fallback();
    const error = (status, body) =>
      route.fulfill({
        status,
        contentType: "text/plain",
        headers: { "Cache-Control": "no-store" },
        body,
      });
    const reply = (result) =>
      route.fulfill({
        headers: { "Cache-Control": "no-store" },
        json: { result: structuredClone(result), context: {} },
      });
    const headers = request.headers();
    if (
      isActive() !== true ||
      (Object.hasOwn(headers, "x-kova-owner") &&
        headers["x-kova-owner"] !== PROJECT_MOVE_REVIEW_OWNER)
    )
      return error(401, "Synthetic Project Move owner does not match this review session.");
    const method = name === "moveChatToProject" ? "POST" : "GET";
    if (request.method() !== method)
      return error(405, "Unsupported synthetic Project Move request method.");
    let data;
    try {
      if (
        (method === "GET" && url.searchParams.getAll("payload").length !== 1) ||
        (method === "POST" && url.searchParams.has("payload"))
      )
        throw new Error("Ambiguous payload");
      const raw = method === "GET" ? url.searchParams.get("payload") : request.postData();
      if (typeof raw !== "string" || !raw || raw.length > 32768 || Buffer.byteLength(raw) > 32768)
        throw new Error("Unbounded payload");
      const envelope = fromJSON(JSON.parse(raw));
      if (
        !plainObject(envelope) ||
        Object.keys(envelope).some((key) => !["data", "context"].includes(key)) ||
        (envelope.context !== undefined &&
          (!plainObject(envelope.context) || Object.keys(envelope.context).length !== 0))
      )
        throw new Error("Invalid envelope");
      data = envelope.data;
      if (
        !plainObject(data) ||
        Object.keys(data).length !== fields[name].length ||
        fields[name].some((key) => !Object.hasOwn(data, key) || typeof data[key] !== "string")
      )
        throw new Error("Invalid data");
    } catch {
      return error(400, "A bounded existing Project Move payload is required.");
    }
    if (name === "listProjectChats") {
      if (!currentProject(data.project_id))
        return error(404, "Choose one of the two existing synthetic projects.");
      const { project_id, snapshot, ...summary } = chat;
      return reply(project_id === data.project_id ? [summary] : []);
    }
    if ((name === "getProjectChat" ? data.id : data.chat_id) !== chat.id)
      return error(404, "Choose the existing synthetic project chat.");
    const previous = currentProject(chat.project_id);
    if (!previous) return error(404, "The sample chat's project is no longer available.");
    if (name === "getProjectChat") return reply(chat);
    const destination = currentProject(data.project_id);
    if (!destination) return error(404, "Choose one of the two existing synthetic projects.");
    if (previous.role === "viewer" || destination.role === "viewer")
      return error(403, "The synthetic owner must be able to edit both sample projects.");
    if (destination.id === chat.project_id)
      return error(409, "The sample chat is already in that project. Check its current location.");
    chat.project_id = destination.id;
    chat.updated_at = new Date(Date.parse(sampleTime) + ++moves * 1000).toISOString();
    syncCounts();
    return reply({ ok: true });
  };
}
