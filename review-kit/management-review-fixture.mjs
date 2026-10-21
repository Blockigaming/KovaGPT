import { fromJSON } from "seroval";
import { validReviewChatBody, reviewChatTextCompletion } from "./chat-stream-review-fixture.mjs";

// Private HTTP review only. These finite samples reuse the existing task engine
// and disposable CRUD project array. No execution, provider or durable write.
export const MANAGEMENT_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const MANAGEMENT_REVIEW_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
export const MANAGEMENT_REVIEW_CHAT_ID = "acacacac-acac-4cac-8cac-acacacacacac";
export const MANAGEMENT_REVIEW_OPTIONS = Object.freeze([
  Object.freeze({
    id: "tasks-management-recovery",
    label: "tasks-management-recovery · Pause / Resume / Create pending, fail once, retry locally",
    accounts: Object.freeze(["free", "plus", "pro"]),
    path: "/scheduled-tasks",
  }),
  Object.freeze({
    id: "project-management-recovery",
    label: "project-management-recovery · Context fail once / Retry, one local New chat",
    accounts: Object.freeze(["free", "plus", "pro"]),
    path: `/projects/${MANAGEMENT_REVIEW_PROJECT_ID}`,
  }),
]);
export const MANAGEMENT_REVIEW_SCENARIOS = Object.freeze(
  MANAGEMENT_REVIEW_OPTIONS.map(({ id }) => id),
);
export const MANAGEMENT_REVIEW_DISCLOSURE =
  "tasks-management-recovery supports one Pause, one Resume and one Create operation. Each first valid request stays pending for at most 20 seconds, then fails without changing its record or revision. Explicitly repeat the same action, or use the editor's Retry, to save the exact retained task ID, mutation ID and payload locally. Other edits, deletes, connected context and execution are unavailable; synthetic eligibility only exposes the controls. project-management-recovery fails the first Context Save changes; the draft remains in the actual client and Retry updates only this session's existing project instructions, visible on reload. New chat creates at most one empty sample using the existing createProjectChat contract; its returned ID is readable in the same project's list/detail and survives navigation within this session. Sending AI messages, saving versions and other project/chat mutations are unavailable. Reset discards changes and re-arms failures. Sign-out, reset and request abort cancel pending requests; no real task, project, conversation or account is changed.";

export const WRITING_REVIEW_SELECTION =
  "1. Choose one small, fictional task for the sample session.\n   - Place the reference note beside the working draft.\n   - Leave a little empty space so the next step is easy to find.\n2. Read the sample once before making a local edit.\n3. End with a short review of what changed.";
export const WRITING_REVIEW_REPLACEMENT =
  "1. Choose one tiny, fictional task for this local sample.\n   - Place the reference note beside the working draft.\n   - Leave a little empty space so the next step is easy to find.\n2. Read the sample once before making a local edit.\n3. Finish by naming the two visible sample changes.";
export const WRITING_REVIEW_DIFF_DISCLOSURE =
  "For a session-only selection diff, choose New chat, enable Temporary Chat with the clean context option, then send harmless plain text. Up to two requests return the same fixed fictional writing sample through the actual chat SSE contract; no prompt is echoed or saved. Open that Temporary Chat writing Result and select the complete five-line numbered list under Prepare a calm workspace. Ask for any wording change. The exact custom /api/write request returns a fixed replacement changing the first and last lines, with three unchanged lines between. Inspect individual Reject, Reject all and Accept using the actual local diff controls. Up to eight requests are available per session. This Result has canPersistVersions=false: acceptance is session-only, no saveMessageVersion or durable acceptance is supported, and no model is called. Other selections, rewrite actions and routes stay unavailable.";

const origin = "http://127.0.0.1:4189";
const owner = MANAGEMENT_REVIEW_OWNER;
const projectId = MANAGEMENT_REVIEW_PROJECT_ID;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (data, required, optional = []) =>
  plain(data) &&
  required.every((key) => Object.hasOwn(data, key)) &&
  Object.keys(data).every((key) => [...required, ...optional].includes(key));
const error = (route, status, message) =>
  route.fulfill({
    status,
    headers: { "Cache-Control": "no-store" },
    contentType: "text/plain",
    body: message,
  });
const reply = (route, result) =>
  route.fulfill({
    headers: { "Cache-Control": "no-store" },
    json: { result: structuredClone(result), context: {} },
  });
function readData(request, method, noInput = false) {
  const url = new URL(request.url());
  if (
    [...url.searchParams.keys()].some((key) => method !== "GET" || key !== "payload") ||
    (method === "GET" &&
      ((noInput
        ? url.searchParams.getAll("payload").length > 1
        : url.searchParams.getAll("payload").length !== 1) ||
        request.postData()))
  )
    throw Error("Ambiguous payload");
  const raw = method === "GET" ? url.searchParams.get("payload") : request.postData();
  if (noInput && raw === null) return {};
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > 32768)
    throw Error("Unbounded payload");
  const envelope = fromJSON(JSON.parse(raw));
  if (
    !exact(envelope, noInput ? [] : ["data"], noInput ? ["data", "context"] : ["context"]) ||
    (envelope.context !== undefined && !exact(envelope.context, [])) ||
    (!(noInput && envelope.data === undefined) && !plain(envelope.data))
  )
    throw Error("Invalid envelope");
  return envelope.data ?? {};
}
function activeOwner(request, isActive) {
  const headers = request.headers();
  return (
    isActive() === true &&
    (!Object.hasOwn(headers, "x-kova-owner") || headers["x-kova-owner"] === owner)
  );
}
const taskReads = new Set([
  "isScheduledTasksEligible",
  "listScheduledTasks",
  "listScheduledTaskOffers",
  "listScheduledTaskConnections",
  "listScheduledTaskRuns",
  "listScheduledTaskContextOptions",
]);
const taskNames = new Set([
  ...taskReads,
  "createScheduledTask",
  "updateScheduledTask",
  "deleteScheduledTask",
  "listScheduledTaskResourceOptions",
  "offerScheduledTaskCopy",
  "decideScheduledTaskCopy",
  "grantScheduledTaskConnection",
  "revokeScheduledTaskConnection",
]);
const projectNames = new Set([
  "getProject",
  "listProjects",
  "updateProject",
  "createProjectChat",
  "getProjectChat",
  "listProjectChats",
  "saveProjectChat",
  "deleteProjectChat",
  "moveChatToProject",
  "createProject",
  "deleteProject",
]);

export function createManagementReviewHandler(
  scenario,
  functionNames,
  { isActive, wait, taskState, getProjects } = {},
) {
  if (
    !MANAGEMENT_REVIEW_SCENARIOS.includes(scenario) ||
    typeof isActive !== "function" ||
    !(functionNames instanceof Map)
  )
    throw Error("An explicit active management review is required.");
  const tasks = scenario === "tasks-management-recovery";
  if (
    tasks
      ? typeof wait !== "function" || typeof taskState !== "function"
      : typeof getProjects !== "function"
  )
    throw Error("Management review requires its bounded hold and existing disposable state.");
  for (const name of tasks
    ? [...taskReads, "createScheduledTask", "updateScheduledTask"]
    : [
        "getProject",
        "listProjects",
        "updateProject",
        "createProjectChat",
        "getProjectChat",
        "listProjectChats",
      ])
    if (![...functionNames.values()].some((value) => value.split("_")[0] === name))
      throw Error(`The packaged management contract is missing ${name}.`);
  const slots = new Map(); // At most three operations: Pause, Resume, Create.
  let contextFailed = false;
  let chat = null;
  const currentProject = () => {
    const project = getProjects?.()?.find((p) => p.id === projectId);
    return project?.owner_id === owner && project.role === "owner" && !project.deletion_requested_at
      ? project
      : null;
  };
  if (!tasks && (!isActive() || !currentProject()))
    throw Error("Existing synthetic project owner required.");
  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name =
      url.origin === origin && /^\/_serverFn\/[^/]+$/.test(url.pathname)
        ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
        : "";
    if (!(tasks ? taskNames : projectNames).has(name)) return route.fallback();
    if (!activeOwner(request, isActive))
      return error(route, 401, "Synthetic management owner changed. Reset the review.");
    if (request.signal?.()?.aborted)
      return error(route, 499, "Synthetic management request canceled.");
    const method = tasks || ["updateProject", "createProjectChat"].includes(name) ? "POST" : "GET";
    if (request.method() !== method)
      return error(route, 405, "Unsupported synthetic management method.");
    let data;
    try {
      data = readData(request, method, name === "listProjects");
    } catch {
      return error(route, 400, "A bounded existing management payload is required.");
    }
    if (tasks) {
      if (data.expectedUserId !== owner)
        return error(route, 401, "Synthetic task principal does not match.");
      const validRead =
        taskReads.has(name) &&
        (name === "listScheduledTaskRuns"
          ? exact(data, ["expectedUserId", "taskId"], ["before"]) &&
            uuid.test(data.taskId) &&
            (data.before === undefined ||
              (typeof data.before === "string" &&
                /^\d{4}-\d{2}-\d{2}T/.test(data.before) &&
                Number.isFinite(Date.parse(data.before))))
          : name === "listScheduledTaskContextOptions"
            ? exact(data, ["expectedUserId", "kind"], ["after"]) &&
              ["library", "project_file"].includes(data.kind) &&
              (data.after == null || uuid.test(data.after))
            : exact(data, ["expectedUserId"]));
      if (taskReads.has(name)) {
        if (!validRead) return error(route, 400, "Invalid synthetic task read.");
        try {
          return reply(route, taskState(name, request));
        } catch (reason) {
          return error(route, 400, reason.message);
        }
      }
      const create = name === "createScheduledTask";
      const status =
        name === "updateScheduledTask" && ["paused", "scheduled"].includes(data.status);
      if (!create && !status)
        return error(
          route,
          405,
          "Only one synthetic Pause, Resume and Create are supported. Reset to inspect again.",
        );
      if (
        !uuid.test(data.id ?? "") ||
        !uuid.test(data.mutationId ?? "") ||
        (create
          ? !exact(
              data,
              ["expectedUserId", "id", "mutationId", "title", "prompt"],
              [
                "repeat",
                "timezone",
                "localTime",
                "run_at",
                "triggerMode",
                "contextRefs",
                "eventTriggers",
              ],
            )
          : !exact(data, ["expectedUserId", "id", "mutationId", "expectedRevision", "status"]) ||
            !Number.isSafeInteger(data.expectedRevision) ||
            data.expectedRevision < 0)
      )
        return error(route, 400, "Existing task identity and time-only payload required.");
      const action = create ? "create" : data.status;
      const fingerprint = JSON.stringify({ name, data });
      const slot = slots.get(action);
      if (slot && slot.fingerprint !== fingerprint)
        return error(
          route,
          409,
          "Retry the same synthetic operation with its retained identity; reset for another sample.",
        );
      if (slot?.phase === "pending")
        return error(route, 409, "This synthetic operation is still pending.");
      // Dry validation must not write records, revisions or mutation receipts.
      try {
        taskState(name, request, { commit: false });
      } catch (reason) {
        return error(route, 409, reason.message);
      }
      if (!slot) {
        const pending = { fingerprint, phase: "pending" };
        slots.set(action, pending);
        const outcome = await wait(request.signal?.());
        if (!activeOwner(request, isActive))
          return error(route, 401, "Synthetic management owner changed. No task was changed.");
        if (outcome !== "expired") {
          slots.delete(action);
          return error(
            route,
            outcome === "capacity" ? 429 : 499,
            "Synthetic task request canceled. No task was changed.",
          );
        }
        pending.phase = "failed";
        return error(
          route,
          503,
          `Simulated ${create ? "Create" : data.status === "paused" ? "Pause" : "Resume"} failure. The record and revision are unchanged. Retry the same action.`,
        );
      }
      try {
        const result = taskState(name, request);
        slot.phase = "saved";
        return reply(route, result);
      } catch (reason) {
        return error(route, 409, reason.message);
      }
    }
    const project = currentProject();
    if (!project) return error(route, 403, "The existing synthetic project owner is required.");
    if (name === "getProject" || name === "listProjects") {
      if (
        name === "listProjects" ? !exact(data, []) : !exact(data, ["id"]) || data.id !== projectId
      )
        return error(route, 404, "Choose the existing synthetic project.");
      return reply(route, name === "listProjects" ? [project] : project);
    }
    if (name === "updateProject") {
      if (
        !exact(data, ["id", "system_prompt"]) ||
        data.id !== projectId ||
        (data.system_prompt !== null &&
          (typeof data.system_prompt !== "string" || data.system_prompt.trim().length > 4000))
      )
        return error(
          route,
          400,
          "Only the existing project's bounded Context instructions are supported.",
        );
      if (!contextFailed) {
        contextFailed = true;
        return error(
          route,
          503,
          "Simulated Context save failure. The saved instructions are unchanged; retry your preserved draft.",
        );
      }
      project.system_prompt = data.system_prompt === null ? null : data.system_prompt.trim();
      return reply(route, { ok: true });
    }
    if (name === "createProjectChat") {
      if (
        !exact(data, ["project_id"], ["title", "messages"]) ||
        data.project_id !== projectId ||
        (data.title !== undefined &&
          (typeof data.title !== "string" ||
            !data.title.trim() ||
            data.title.trim().length > 200)) ||
        (data.messages !== undefined && (!Array.isArray(data.messages) || data.messages.length))
      )
        return error(
          route,
          400,
          "Only one empty chat in the existing synthetic project is supported.",
        );
      if (chat)
        return error(
          route,
          409,
          "The one sample chat already exists. Open it or reset the review.",
        );
      chat = {
        id: MANAGEMENT_REVIEW_CHAT_ID,
        project_id: projectId,
        title: data.title?.trim() ?? "Untitled chat",
        snapshot: { messages: [] },
        updated_at: "2026-10-19T00:00:00.000Z",
        created_by: owner,
      };
      project.chat_count = 1;
      return reply(route, { id: chat.id });
    }
    if (name === "listProjectChats") {
      if (!exact(data, ["project_id"]) || data.project_id !== projectId)
        return error(route, 404, "Choose the existing synthetic project.");
      if (!chat) return reply(route, []);
      const { project_id, snapshot, ...summary } = chat;
      return reply(route, [summary]);
    }
    if (name === "getProjectChat") {
      if (!exact(data, ["id"]) || !uuid.test(data.id ?? ""))
        return error(route, 400, "Existing project-chat identity required.");
      return reply(route, data.id === chat?.id ? chat : null);
    }
    return error(
      route,
      405,
      "Only Context and one empty New chat are available in this synthetic project sample.",
    );
  };
}

export function createWritingDiffReviewHandler({ isActive, writingSample } = {}) {
  if (
    typeof isActive !== "function" ||
    typeof writingSample !== "string" ||
    !writingSample.includes(WRITING_REVIEW_SELECTION) ||
    writingSample.length > 8000
  )
    throw Error("Active writing review and existing bounded sample required.");
  let requests = 0,
    chatRequests = 0;
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin || !["/api/write", "/api/chat"].includes(url.pathname))
      return route.fallback();
    const fail = (status, message) =>
      route.fulfill({ status, headers: { "Cache-Control": "no-store" }, json: { error: message } });
    if (!activeOwner(request, isActive) || request.headers()["x-kova-owner"] !== owner)
      return fail(401, "Synthetic writing account changed.");
    if (request.signal?.()?.aborted) return fail(499, "Synthetic writing request canceled.");
    if (request.method() !== "POST") return fail(405, "Synthetic writing requires POST.");
    let body;
    try {
      const raw = request.postData();
      if (
        url.search ||
        !/^application\/json(?:;|$)/i.test(request.headers()["content-type"] ?? "") ||
        typeof raw !== "string" ||
        Buffer.byteLength(raw) > 16384
      )
        throw Error();
      body = JSON.parse(raw);
      if (url.pathname === "/api/chat") {
        if (
          !validReviewChatBody(body) ||
          !exact(
            body,
            [
              "chatId",
              "mode",
              "messages",
              "temporary",
              "temporaryContext",
              "historyOffset",
              "memoryStartIndex",
            ],
            ["clientTool", "timezone", "locale"],
          ) ||
          body.temporary !== true ||
          body.temporaryContext !== "clean" ||
          body.messages.length !== 1 ||
          body.messages[0].role !== "user" ||
          !exact(body.messages[0], ["role", "content"], ["attachments"]) ||
          body.messages[0].content.length > 2000 ||
          body.historyOffset !== 0 ||
          body.memoryStartIndex !== 0 ||
          (body.timezone !== undefined &&
            (typeof body.timezone !== "string" || body.timezone.length > 100)) ||
          (body.locale !== undefined &&
            (typeof body.locale !== "string" || body.locale.length > 100))
        )
          return fail(
            400,
            "Start a fresh clean Temporary Chat and send bounded plain text without tools or files.",
          );
        if (chatRequests >= 2)
          return fail(429, "The two temporary writing samples are used. Reset to inspect again.");
        chatRequests += 1;
        return route.fulfill({
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "X-Kova-Review-Only": "synthetic-temporary-writing",
          },
          contentType: "text/event-stream; charset=utf-8",
          body: reviewChatTextCompletion(writingSample),
        });
      }
      if (
        !exact(body, ["text", "action", "instructions"]) ||
        body.text !== WRITING_REVIEW_SELECTION ||
        body.action !== "custom" ||
        typeof body.instructions !== "string" ||
        !body.instructions.trim() ||
        body.instructions.length > 4096 ||
        !body.instructions.startsWith(
          "Rewrite ONLY the selected passage from a longer answer. Instruction: ",
        )
      )
        throw Error();
    } catch {
      return fail(
        400,
        "Select the complete sample numbered list and use the existing custom rewrite action.",
      );
    }
    if (requests >= 8)
      return fail(429, "The eight local rewrite samples are used. Reset to inspect again.");
    requests += 1;
    return route.fulfill({
      headers: { "Cache-Control": "no-store" },
      json: { text: WRITING_REVIEW_REPLACEMENT },
    });
  };
}
