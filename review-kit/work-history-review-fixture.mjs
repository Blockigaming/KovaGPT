import { fromJSON } from "seroval";

// Private review only. These are the existing historical Work GET DTOs, not an
// execution simulator. No backend, provider, account, or storage module is used.
export const WORK_HISTORY_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const WORK_HISTORY_REVIEW_RUN_ID = "67676767-6767-4767-8767-676767676767";
export const WORK_HISTORY_REVIEW_DISCLOSURE =
  "Synthetic historical Work reads only. Pending holds are bounded; errors and empty lists are deliberate local samples. Sample run records, tasks, events, and denied approvals are fictional. Detail-empty means a sample run with empty related collections. No work starts, runs, resumes, or changes; no provider, account, or backend is contacted.";
export const WORK_HISTORY_REVIEW_SCENARIOS = Object.freeze([
  "work-history-list-pending",
  "work-history-list-error",
  "work-history-list-empty",
  "work-history-detail-pending",
  "work-history-detail-error",
  "work-history-detail-empty",
  "work-history-detail-sample",
]);
export const WORK_HISTORY_REVIEW_OPTIONS = Object.freeze(
  WORK_HISTORY_REVIEW_SCENARIOS.map((id) =>
    Object.freeze({ id, accounts: Object.freeze(["free", "plus", "pro"]), path: "/work" }),
  ),
);
const origin = "http://127.0.0.1:4189";
const reads = new Set(["listWorkRuns", "getWorkRun"]);
const unsupported = new Set([
  "controlWorkRun",
  "saveGraphPreference",
  "renameDeliverable",
  "moveDeliverable",
  "deleteDeliverable",
  "restoreDeliverable",
  "duplicateDeliverable",
  "downloadDeliverable",
  "restoreDeliverableRevision",
  "decideApproval",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const taskIds = ["67676767-6767-4767-8767-676767676768", "67676767-6767-4767-8767-676767676769"];
const createdAt = "2026-10-17T09:00:00.000Z";
const completedAt = "2026-10-17T09:02:00.000Z";

function sampleRun() {
  // WorkRun from src/lib/work.functions.ts has no owner/title fields. The
  // principal is enforced by the enclosing disposable session, as in production.
  return {
    id: WORK_HISTORY_REVIEW_RUN_ID,
    kind: "team",
    status: "completed",
    attempts: 1,
    maxAttempts: 1,
    projectId: null,
    createdAt,
    startedAt: createdAt,
    completedAt,
    error: null,
    input: {
      objective: "Synthetic historical Work sample for local interface review",
      sampleOnly: true,
      disclosure: WORK_HISTORY_REVIEW_DISCLOSURE,
    },
  };
}
function sampleDetail(empty) {
  const run = sampleRun();
  if (empty)
    return {
      run,
      events: [],
      deliverables: [],
      approvals: [],
      tasks: [],
      edges: [],
      graphPreference: null,
    };
  return {
    run,
    events: [
      {
        id: 1,
        type: "objective",
        payload: {
          title: "Synthetic review objective",
          objective: "Inspect fictional historical Work records. No work was executed.",
          specialist_task_id: taskIds[0],
          sampleOnly: true,
        },
        createdAt,
        previewUrl: null,
      },
      {
        id: 2,
        type: "evidence",
        payload: {
          title: "Synthetic text evidence · no browser or provider was used",
          specialist_task_id: taskIds[1],
          summary: "Fictional sample evidence for the local Work interface.",
          sampleOnly: true,
        },
        createdAt: completedAt,
        previewUrl: null,
      },
    ],
    // Avoid inventing storage links or making mutating deliverable controls look
    // operational. Deliverable/approval writes remain explicitly unavailable.
    deliverables: [],
    approvals: [
      {
        id: "67676767-6767-4767-8767-676767676770",
        runId: WORK_HISTORY_REVIEW_RUN_ID,
        tool: "Synthetic sample action",
        reason: "Fictional historical denial; no action was requested or performed.",
        destination: "Local review only",
        risk: "low",
        status: "denied",
        request: { sampleOnly: true, disclosure: WORK_HISTORY_REVIEW_DISCLOSURE },
        createdAt,
      },
    ],
    tasks: taskIds.map((id, index) => ({
      id,
      key: `synthetic-review-${index + 1}`,
      role: index === 0 ? "Sample reviewer" : "Sample editor",
      objective: "Synthetic historical task. No background execution occurred.",
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      startedAt: index === 0 ? createdAt : "2026-10-17T09:01:00.000Z",
      completedAt: index === 0 ? "2026-10-17T09:01:00.000Z" : completedAt,
    })),
    edges: [
      {
        id: "67676767-6767-4767-8767-676767676771",
        source: taskIds[0],
        target: taskIds[1],
        type: "requires",
        condition: null,
        metadata: { sampleOnly: true },
      },
    ],
    graphPreference: {
      direction: "LR",
      density: "comfortable",
      positions: {},
      pinned: [],
    },
  };
}
function readPayload(request, url, name) {
  if ([...url.searchParams.keys()].some((key) => key !== "payload"))
    throw new Error("Unsupported query");
  const values = url.searchParams.getAll("payload");
  if (values.length > 1 || request.postData()) throw new Error("Ambiguous payload");
  if (!values.length) {
    if (name === "listWorkRuns") return undefined;
    throw new Error("Missing run payload");
  }
  const raw = values[0];
  if (!raw || raw.length > 32768 || Buffer.byteLength(raw) > 32768)
    throw new Error("Unbounded payload");
  const envelope = fromJSON(JSON.parse(raw));
  if (
    !plainObject(envelope) ||
    Object.keys(envelope).some((key) => !["data", "context"].includes(key)) ||
    (envelope.context !== undefined &&
      (!plainObject(envelope.context) || Object.keys(envelope.context).length))
  )
    throw new Error("Unsupported envelope");
  const data = envelope.data;
  if (name === "listWorkRuns") {
    if (data !== undefined && (!plainObject(data) || Object.keys(data).length))
      throw new Error("List read has no input");
  } else if (
    !plainObject(data) ||
    Object.keys(data).length !== 1 ||
    !Object.hasOwn(data, "id") ||
    typeof data.id !== "string" ||
    !uuid.test(data.id)
  )
    throw new Error("Invalid run ID");
  return data;
}

/** Parent must bind isActive to this signed-in disposable session and supply
 * its bounded read-hold wait(signal). Pending never falls through to a backend.
 * Install after core/recovery fixtures. In-flight cancellation is owned by the
 * parent session; this handler creates no timers or accumulating request log.
 */
export function createWorkHistoryReviewHandler(scenario, functionNames, { isActive, wait } = {}) {
  if (!WORK_HISTORY_REVIEW_SCENARIOS.includes(scenario))
    throw new Error("Unknown historical Work review scenario.");
  if (
    typeof isActive !== "function" ||
    (scenario.endsWith("-pending") && typeof wait !== "function")
  )
    throw new Error("Historical Work review requires its active session and bounded pending hold.");
  if (!(functionNames instanceof Map))
    throw new Error("Historical Work function manifest is required.");
  // Capture the manifest per installation, so a caller cannot redirect an
  // already installed session by later mutating its function-name map.
  const names = new Map(functionNames);
  for (const name of reads)
    if (![...names.values()].some((value) => value.split("_")[0] === name))
      throw new Error(`The packaged historical Work contract is missing ${name}.`);
  const detail = sampleDetail(scenario === "work-history-detail-empty");
  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const name = /^\/_serverFn\/[^/]+$/.test(url.pathname)
      ? (names.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    const executionWrite = url.pathname === "/api/work/execution" && request.method() !== "GET";
    if (!reads.has(name) && !unsupported.has(name) && !executionWrite) return route.fallback();
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
        headers["x-kova-owner"] !== WORK_HISTORY_REVIEW_OWNER)
    )
      return error(401, "Synthetic historical Work owner does not match this review session.");
    if (executionWrite || unsupported.has(name) || request.method() !== "GET")
      return error(
        405,
        "Synthetic historical Work is read-only; no execution or account changes are available.",
      );
    let data;
    try {
      data = readPayload(request, url, name);
    } catch {
      return error(400, "A bounded existing historical Work read payload is required.");
    }
    if (
      name === "getWorkRun" &&
      (data.id !== WORK_HISTORY_REVIEW_RUN_ID || scenario === "work-history-list-empty")
    )
      return error(404, "No matching synthetic historical Work run exists in this session.");
    const pending =
      (name === "listWorkRuns" && scenario === "work-history-list-pending") ||
      (name === "getWorkRun" && scenario === "work-history-detail-pending");
    if (pending) {
      let reason;
      try {
        reason = await wait(request.signal?.());
      } catch {
        reason = "failed";
      }
      if (reason === "aborted" || reason === "reset")
        return error(499, "Synthetic historical Work loading inspection canceled.");
      if (isActive() !== true)
        return error(401, "Synthetic historical Work session is no longer active.");
      return error(
        503,
        reason === "capacity"
          ? "Synthetic loading request limit reached. Reset to continue."
          : "Synthetic historical Work loading hold ended. Reset to inspect again; no backend was read.",
      );
    }
    if (
      (name === "listWorkRuns" && scenario === "work-history-list-error") ||
      (name === "getWorkRun" && scenario === "work-history-detail-error")
    )
      return error(503, "Simulated historical Work read failure. No backend was contacted.");
    return route.fulfill({
      headers: { "Cache-Control": "no-store" },
      json: {
        result: structuredClone(
          name === "listWorkRuns"
            ? scenario === "work-history-list-empty"
              ? []
              : [detail.run]
            : detail,
        ),
        context: {},
      },
    });
  };
}

export async function installWorkHistoryReviewFixture(registry, scenario, functionNames, options) {
  const handler = createWorkHistoryReviewHandler(scenario, functionNames, options);
  await registry.route(origin + "/_serverFn/*", handler);
  await registry.route(origin + "/api/work/execution", handler);
  return handler;
}
