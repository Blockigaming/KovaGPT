import { REVIEWED_MEMORY_OPTIONS } from "./reviewed-memory-review-fixture.mjs";
import { PROJECT_ARCHIVE_REVIEW_OPTION } from "./project-archive-review-fixture.mjs";
import { PROJECT_POPULATED_ARCHIVE_REVIEW_OPTION } from "./project-populated-archive-review-fixture.mjs";
import { PROJECT_MEMBER_REVIEW_OPTION } from "./project-member-review-fixture.mjs";
import { CONDITIONAL_REVIEW_OPTIONS } from "./conditional-review-fixture.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fromJSON, toJSON } from "seroval";
import { parseTaskPayload } from "../src/lib/scheduled-task-policy.mjs";
import { ASYNC_READ_REVIEW_OPTIONS } from "./async-read-review-fixture.mjs";
import { WORK_HISTORY_REVIEW_OPTIONS } from "./work-history-review-fixture.mjs";
import { SUPPORT_REVIEW_OPTIONS } from "./support-review-fixture.mjs";
import {
  REVIEW_CHAT_RESPONSE_OPTIONS,
  REVIEW_CHAT_INSPECTION_OPTIONS,
} from "./chat-stream-review-fixture.mjs";
import { MANAGEMENT_REVIEW_OPTIONS } from "./management-review-fixture.mjs";
import { DIRECTORY_PLUGIN_REVIEW_OPTIONS } from "./directory-plugin-review-fixture.mjs";
import { VERSION_CONFLICT_REVIEW_OPTIONS } from "./version-conflict-review-fixture.mjs";
import { LIBRARY_PDF_RESOURCE_REVIEW_OPTION } from "./library-pdf-resource-review-fixture.mjs";
import { GENERATIVE_UI_REVIEW_OPTION } from "./generative-ui-review-fixture.mjs";
const additionalHttpOptions = [
  GENERATIVE_UI_REVIEW_OPTION,
  LIBRARY_PDF_RESOURCE_REVIEW_OPTION,
  ...VERSION_CONFLICT_REVIEW_OPTIONS,
  ...REVIEWED_MEMORY_OPTIONS,
  PROJECT_ARCHIVE_REVIEW_OPTION,
  PROJECT_POPULATED_ARCHIVE_REVIEW_OPTION,
  PROJECT_MEMBER_REVIEW_OPTION,
  ...CONDITIONAL_REVIEW_OPTIONS,
  ...REVIEW_CHAT_RESPONSE_OPTIONS,
  ...REVIEW_CHAT_INSPECTION_OPTIONS,
  ...ASYNC_READ_REVIEW_OPTIONS,
  ...WORK_HISTORY_REVIEW_OPTIONS,
  ...SUPPORT_REVIEW_OPTIONS,
  ...DIRECTORY_PLUGIN_REVIEW_OPTIONS,
  ...MANAGEMENT_REVIEW_OPTIONS,
];
const additionalHttpScenarios = new Set(additionalHttpOptions.map(({ id }) => id));

// Review tooling only. Install after the base/core fixtures; never import this
// module into application source. Responses use the existing server contracts.
const signedIn = ["free", "plus", "pro"];
const allAccounts = ["guest", ...signedIn];
export const REVIEW_STATE_OPTIONS = Object.freeze(
  [
    { id: "default", accounts: allAccounts, path: null },
    {
      id: "route-error-recovery",
      label: "route-error-recovery · chosen start page; first Knowledge Graph read fails",
      accounts: signedIn,
      path: null,
    },
    {
      id: "item313-timestamp-review",
      label: "item313-timestamp-review · read-only synthetic timestamps",
      accounts: signedIn,
      path: "/audit-log",
    },
    {
      id: "library-document-review",
      label: "library-document-review · synthetic original PDF and invalid preview",
      accounts: signedIn,
      path: "/library",
    },
    ...additionalHttpOptions,
    { id: "account-loading", accounts: signedIn, path: "/" },
    { id: "account-plan-loading", accounts: signedIn, path: "/" },
    { id: "chat-many-history", accounts: signedIn, path: "/" },
    { id: "chat-stream-review", accounts: signedIn, path: "/" },
    {
      id: "project-move-review",
      accounts: signedIn,
      path: "/projects/33333333-3333-4333-8333-333333333333",
    },
    { id: "font-load-failure", accounts: allAccounts, path: null },
    { id: "accessibility-text-spacing", accounts: allAccounts, path: null },
    { id: "picker-many-projects", accounts: signedIn, path: "/work" },
    { id: "assistant-directory-recovery", accounts: allAccounts, path: "/assistants" },
    ...["account-export-ready", "account-export-failed", "account-export-uncertain"].map((id) => ({
      id,
      accounts: signedIn,
      path: "/settings/privacy",
    })),
    // Ordinary HTTP adapter seeds this isolated conversation and its history.
    { id: "chat-outputs", accounts: signedIn, path: "/" },
    { id: "chat-long-content", accounts: signedIn, path: "/" },
    {
      id: "chat-prose-numbering-review",
      label: "chat-prose-numbering-review · read-only long prose and nested ordered list",
      accounts: signedIn,
      path: "/",
    },
    { id: "chat-trash", accounts: signedIn, path: "/settings/privacy" },
    { id: "chat-copy-task", accounts: signedIn, path: "/" },
    { id: "chat-task-unconfirmed", accounts: signedIn, path: "/" },
    { id: "chat-sources-used", accounts: signedIn, path: "/" },
    { id: "voice-catalog", accounts: signedIn, path: "/" },
    { id: "tasks-editor", accounts: signedIn, path: "/scheduled-tasks" },
    ...["tasks-history-error", "tasks-history-empty"].map((id) => ({
      id,
      label: `${id} · read-only last-run sample`,
      accounts: signedIn,
      path: "/scheduled-tasks",
    })),
    {
      id: "project-create-uncertain",
      label: "project-create-uncertain · unconfirmed, no project created",
      accounts: signedIn,
      path: "/projects",
    },
    ...["project-list-recovery", "project-mutation-recovery"].map((id) => ({
      id,
      label:
        id === "project-list-recovery"
          ? "project-list-recovery · Tasks / Memory fail once, Retry recovers"
          : "project-mutation-recovery · Project actions fail once, retry locally",
      accounts: signedIn,
      path: "/projects/33333333-3333-4333-8333-333333333333",
    })),
    { id: "billing-trial-active", accounts: ["plus"], path: "/" },
    { id: "billing-trial-canceled", accounts: ["plus"], path: "/" },
    { id: "billing-payment-past-due", accounts: ["plus", "pro"], path: "/" },
    { id: "billing-portal-failure", accounts: ["plus", "pro"], path: "/" },
    { id: "billing-unavailable", accounts: signedIn, path: "/" },
    { id: "onboarding-new", accounts: signedIn, path: "/" },
    { id: "onboarding-save-error", accounts: signedIn, path: "/" },
    {
      id: "auth-recovery-sent",
      accounts: allAccounts,
      path: "/auth?email=review%40example.invalid&mode=sign-in",
    },
    {
      id: "auth-recovery-error",
      accounts: allAccounts,
      path: "/auth?email=review%40example.invalid&mode=sign-in",
    },
  ].map((option) => Object.freeze({ ...option, accounts: Object.freeze([...option.accounts]) })),
);
export const REVIEW_STATE_SCENARIOS = Object.freeze(REVIEW_STATE_OPTIONS.map(({ id }) => id));
export const PROJECT_RECOVERY_REVIEW_DISCLOSURE =
  "Project recovery scenarios use only the existing synthetic owner and project. project-list-recovery fails Tasks and Memory reads once, then Retry returns sample rows. project-mutation-recovery fails each task reorder/status/delete, memory add/delete and member remove/revoke action once, then retry changes only this disposable session. Reorder saves one sample position before failing. To inspect revoke, first create a sample .invalid invitation using the existing invite fixture; no invitation is sent. Adding project tasks is unavailable in these bounded samples. Reset discards all changes and re-arms failures; no real backend or provider is connected.";
const origin = "http://127.0.0.1:4189";

function validate(scenario, account) {
  const option = REVIEW_STATE_OPTIONS.find(({ id }) => id === scenario);
  if (!option) throw new Error("Unknown review state scenario");
  if (!option.accounts.includes(account))
    throw new Error(`${scenario} requires a synthetic ${option.accounts.join(" or ")} account`);
  return option;
}

export function readReviewFunctionNames(directory = ".nitro/vite/services/ssr/assets") {
  const names = new Map();
  for (const file of readdirSync(directory).filter((name) => name.startsWith("vendor-tanstack"))) {
    const source = readFileSync(join(directory, file), "utf8");
    for (const match of source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName: "([^"]+)"/g))
      names.set(match[1], match[2]);
  }
  if (!names.size) throw new Error("Review server-function manifest is missing or empty");
  return names;
}

const reviewOwner = "22222222-2222-4222-8222-222222222222";
export const REVIEW_TASK_ID = "77777777-7777-4777-8777-777777777777";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function taskRequest(request) {
  const raw =
    request.method() === "GET"
      ? new URL(request.url()).searchParams.get("payload")
      : request.postData();
  const value = raw ? fromJSON(JSON.parse(raw)) : null;
  if (value?.data?.expectedUserId !== reviewOwner)
    throw new Error("Synthetic task owner does not match this review account.");
  return value.data;
}
function reviewTime(localTime, timezone) {
  // Display-only conversion for the disposable sample. This does not schedule
  // work or emulate production recurrence. Refuse DST gaps/folds rather than
  // invent a production disambiguation rule.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const target = localTime.length === 16 ? localTime + ":00" : localTime;
  const base = Date.parse(target + "Z");
  const matches = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = base + offset * 60000;
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
    );
    if (
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` ===
      target
    )
      matches.push(new Date(instant).toISOString());
  }
  if (matches.length !== 1)
    throw new Error(
      "This sample cannot resolve an ambiguous or unavailable local time. Choose another time.",
    );
  return matches[0];
}
export function createReviewTaskScenario(now) {
  const initialRun = new Date(now + 7 * 86400000).toISOString();
  const records = new Map([
    [
      REVIEW_TASK_ID,
      {
        id: REVIEW_TASK_ID,
        title: "Synthetic review task — never executes",
        prompt: "Sample only. Review the editor and recurrence controls; no background work runs.",
        repeat: "weekly",
        timezone: "UTC",
        schedule_local: initialRun.slice(0, 19),
        run_at: initialRun,
        next_run_at: null,
        status: "paused",
        revision: 1,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        last_run_at: null,
        last_result: null,
        last_error: null,
        trigger_mode: "time",
        context_refs: [],
        event_triggers: [],
      },
    ],
  ]);
  const activeId = "88888888-8888-4888-8888-888888888888";
  records.set(activeId, {
    ...records.get(REVIEW_TASK_ID),
    id: activeId,
    title: "Synthetic active task — never executes",
    status: "scheduled",
    repeat: "daily",
    next_run_at: initialRun,
  });
  const histories = new Map(
    [REVIEW_TASK_ID, activeId].map((id) => [
      id,
      [
        {
          id: `sample-complete-${id}`,
          task_id: id,
          scheduled_for: new Date(now - 86400000).toISOString(),
          started_at: new Date(now - 86400000).toISOString(),
          completed_at: new Date(now - 86400000 + 1000).toISOString(),
          status: "complete",
          result_summary:
            "SAMPLE ONLY: successful result layout. No work ran and no message was delivered.",
          delivery_status: "not_configured",
          failure_type: null,
          retry_eligible: false,
          next_run_at: null,
        },
        {
          id: `sample-failed-${id}`,
          task_id: id,
          scheduled_for: new Date(now - 2 * 86400000).toISOString(),
          started_at: new Date(now - 2 * 86400000).toISOString(),
          completed_at: new Date(now - 2 * 86400000 + 1000).toISOString(),
          status: "failed",
          result_summary:
            "SAMPLE ONLY: temporary failure layout. No provider was contacted and no delivery was attempted.",
          delivery_status: "not_configured",
          failure_type: "temporary",
          retry_eligible: true,
          next_run_at: null,
        },
      ],
    ]),
  );
  const receipts = new Map();
  return (name, request, { commit = true } = {}) => {
    const data = taskRequest(request);
    if (name === "isScheduledTasksEligible") return { eligible: true, executionAvailable: true };
    if (name === "listScheduledTasks") return [...records.values()];
    if (name === "listScheduledTaskOffers") return { sent: [], received: [] };
    if (name === "listScheduledTaskConnections") return { connections: [], grants: [] };
    if (name === "listScheduledTaskContextOptions" || name === "listScheduledTaskResourceOptions")
      return { items: [], nextCursor: null };
    if (name === "listScheduledTaskRuns") {
      if (!records.has(data.taskId)) throw new Error("Synthetic task no longer exists.");
      return (histories.get(data.taskId) ?? []).filter(
        (run) => !data.before || run.scheduled_for < data.before,
      );
    }
    if (!uuid.test(data.id ?? "") || !uuid.test(data.mutationId ?? ""))
      throw new Error("Synthetic task action requires its existing identity contract.");
    const receiptKey = `${data.id}:${data.mutationId}`;
    const fingerprint = JSON.stringify({ name, data });
    if (receipts.has(receiptKey)) {
      const saved = receipts.get(receiptKey);
      if (saved.fingerprint !== fingerprint)
        throw new Error("Synthetic mutation identity was reused for different data.");
      return saved.result;
    }
    const previous = records.get(data.id);
    if (
      name !== "createScheduledTask" &&
      (!previous || data.expectedRevision !== previous.revision)
    )
      throw new Error("This synthetic task changed. Refresh it before applying this action.");
    let result;
    if (name === "deleteScheduledTask") {
      if (commit) {
        records.delete(data.id);
        histories.delete(data.id);
      }
      result = { ok: true };
    } else {
      if (name === "createScheduledTask" && previous)
        throw new Error("Synthetic task already exists.");
      const { expectedUserId, id, mutationId, expectedRevision, status, retry, ...draft } = data;
      let fields = {};
      if (status !== undefined) {
        if (
          name !== "updateScheduledTask" ||
          !["paused", "scheduled"].includes(status) ||
          Object.keys(draft).length ||
          (retry && previous.status !== "failed")
        )
          throw new Error("Unsupported synthetic task status change.");
      } else {
        const payload = parseTaskPayload(draft);
        if (
          payload.triggerMode !== "time" ||
          payload.contextRefs.length ||
          payload.eventTriggers.length
        )
          throw new Error(
            "This review supports time schedules only; connected execution and context are unavailable.",
          );
        const runAt = payload.run_at ?? reviewTime(payload.localTime, payload.timezone);
        fields = {
          title: payload.title,
          prompt: payload.prompt,
          repeat: payload.repeat,
          timezone: payload.timezone,
          schedule_local: payload.localTime ?? runAt.slice(0, 19),
          run_at: runAt,
          next_run_at: null,
          trigger_mode: "time",
          context_refs: [],
          event_triggers: [],
        };
      }
      result = {
        ...previous,
        ...fields,
        id: data.id,
        // Settings edits match mutate_scheduled_task: save paused until explicitly resumed.
        status: status ?? (name === "updateScheduledTask" ? "paused" : "scheduled"),
        revision: (previous?.revision ?? 0) + 1,
        created_at: previous?.created_at ?? new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        last_run_at: null,
        last_result: null,
        last_error: null,
      };
      if (commit) records.set(data.id, result);
    }
    if (commit) receipts.set(receiptKey, { fingerprint, result });
    return result;
  };
}
const taskFunctions = new Set([
  "isScheduledTasksEligible",
  "listScheduledTasks",
  "listScheduledTaskOffers",
  "listScheduledTaskConnections",
  "listScheduledTaskContextOptions",
  "listScheduledTaskResourceOptions",
  "listScheduledTaskRuns",
  "createScheduledTask",
  "updateScheduledTask",
  "deleteScheduledTask",
]);

// The chat receipt has only an ID. Reuse its existing synthetic task row; never
// create a task or fabricate a run merely to make the ordinary deep link resolve.
export const CHAT_RECEIPT_TASK_ID = "88888888-8888-4888-8888-888888888888";
export function createChatReceiptTaskReadHandler(
  scenario,
  account,
  functionNames,
  { isActive, now = Date.now() } = {},
) {
  validate(scenario, account);
  if (
    scenario !== "chat-copy-task" ||
    typeof isActive !== "function" ||
    !(functionNames instanceof Map)
  )
    throw new Error("The exact signed-in chat-copy-task session and manifest are required.");
  const reads = new Set([
    "isScheduledTasksEligible",
    "listScheduledTasks",
    "listScheduledTaskOffers",
    "listScheduledTaskConnections",
    "listScheduledTaskContextOptions",
    "listScheduledTaskRuns",
  ]);
  const names = new Map(functionNames);
  for (const read of reads)
    if (![...names.values()].some((value) => value.split("_")[0] === read))
      throw new Error(`Packaged scheduled-task read contract is missing ${read}.`);
  const rows = createReviewTaskScenario(now)("listScheduledTasks", {
    method: () => "POST",
    postData: () => JSON.stringify(toJSON({ data: { expectedUserId: reviewOwner }, context: {} })),
  });
  const task = rows.find((row) => row.id === CHAT_RECEIPT_TASK_ID);
  if (!task) throw new Error("The existing synthetic receipt task is missing.");
  const plain = (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  return (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const name =
      url.origin === origin && /^\/_serverFn\/[^/]+$/.test(url.pathname)
        ? (names.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
        : "";
    if (!name.includes("ScheduledTask")) return route.fallback();
    const error = (status, message) =>
      route.fulfill({ status, headers: { "Cache-Control": "no-store" }, json: { error: message } });
    const owner = request.headers()["x-kova-owner"];
    if (isActive() !== true || (owner !== undefined && owner !== reviewOwner))
      return error(401, "Synthetic receipt task account does not match.");
    if (request.signal?.()?.aborted) return error(499, "Synthetic receipt task read canceled.");
    if (request.method() !== "POST")
      return error(405, "Use the existing scheduled-task POST read contract.");
    let data;
    try {
      const raw = request.postData();
      if (url.search || !raw || Buffer.byteLength(raw) > 8192) throw new Error();
      const input = fromJSON(JSON.parse(raw));
      if (
        !plain(input) ||
        Object.keys(input).some((key) => !["data", "context"].includes(key)) ||
        (input.context !== undefined &&
          (!plain(input.context) || Object.keys(input.context).length)) ||
        !plain(input.data)
      )
        throw new Error();
      data = input.data;
    } catch {
      return error(400, "Use a bounded exact scheduled-task read payload.");
    }
    if (data.expectedUserId !== reviewOwner)
      return error(401, "Synthetic receipt task principal does not match.");
    if (!reads.has(name))
      return error(
        405,
        "This receipt task is read-only. Creation, edits, pause/resume, deletion, copying, grants and execution are disconnected.",
      );
    const allowed =
      name === "listScheduledTaskRuns"
        ? ["expectedUserId", "taskId", "before"]
        : name === "listScheduledTaskContextOptions"
          ? ["expectedUserId", "kind", "after"]
          : ["expectedUserId"];
    if (Object.keys(data).some((key) => !allowed.includes(key)))
      return error(400, "Unsupported receipt task read field.");
    if (name === "listScheduledTaskRuns") {
      if (
        typeof data.taskId !== "string" ||
        !uuid.test(data.taskId) ||
        (data.before !== undefined &&
          (typeof data.before !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data.before) ||
            !Number.isFinite(Date.parse(data.before))))
      )
        return error(400, "Use the existing task identity and optional UTC history cursor.");
      if (data.taskId !== CHAT_RECEIPT_TASK_ID)
        return error(404, "Only the matching synthetic receipt task is available.");
    }
    if (name === "listScheduledTaskContextOptions") {
      if (
        !["library", "project_file"].includes(data.kind) ||
        (data.after != null && (typeof data.after !== "string" || !uuid.test(data.after)))
      )
        return error(400, "Use the existing empty task-context read contract.");
      if (data.after != null)
        return error(404, "No synthetic context cursor or connected resource exists.");
    }
    const result =
      name === "isScheduledTasksEligible"
        ? { eligible: true, executionAvailable: false, reason: "generation_disabled" }
        : name === "listScheduledTasks"
          ? [task]
          : name === "listScheduledTaskOffers"
            ? { sent: [], received: [] }
            : name === "listScheduledTaskConnections"
              ? { connections: [], grants: [] }
              : name === "listScheduledTaskContextOptions"
                ? { items: [], nextCursor: null }
                : [];
    return route.fulfill({
      status: 200,
      headers: { "Cache-Control": "no-store" },
      json: { result: structuredClone(result), context: {} },
    });
  };
}

// HTTP-review-only handlers. All reads below re-enter the closed local fixture
// registry; no application/provider request or new project permission is made.
export const PROJECT_CREATE_UNCERTAIN_REVIEW_DISCLOSURE =
  "project-create-uncertain rejects only the actual createProject request with a synthetic HTTP 503. No project is created, even after the explicit acknowledged retry. The product correctly treats the response as unconfirmed; its duplicate warning is being inspected, not evidence of a saved project. Use default fixture data so Check Projects can refresh the unchanged existing sample list. Other project reads and actions retain their ordinary disposable fixtures. No backend, provider, invitation or account write occurs through this create response.";

/** Narrow synthetic failure overlay: never reads, retains or mutates project state. */
export function createProjectCreateUncertainReviewHandler(
  account,
  functionNames,
  { isActive } = {},
) {
  validate("project-create-uncertain", account);
  if (typeof isActive !== "function" || !(functionNames instanceof Map))
    throw new Error("Active synthetic project session and manifest required.");
  const ids = new Set(
    [...functionNames]
      .filter(([, value]) => value.split("_")[0] === "createProject")
      .map(([id]) => id),
  );
  if (!ids.size) throw new Error("The packaged createProject contract is missing.");
  const plain = (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      url.origin !== origin ||
      !/^\/_serverFn\/[^/]+$/.test(url.pathname) ||
      !ids.has(url.pathname.split("/").at(-1))
    )
      return route.fallback();
    const error = (status, body) =>
      route.fulfill({
        status,
        contentType: "text/plain",
        headers: {
          "Cache-Control": "no-store",
          "X-Kova-Review-Only": "synthetic-no-project-created",
        },
        body,
      });
    const headers = request.headers();
    if (
      isActive() !== true ||
      (Object.hasOwn(headers, "x-kova-owner") && headers["x-kova-owner"] !== reviewOwner)
    )
      return error(401, "Synthetic project account does not match this review session.");
    if (request.method() !== "POST") return error(405, "Synthetic project creation requires POST.");
    if (request.signal?.()?.aborted)
      return error(499, "Synthetic project inspection canceled. No project was created.");
    try {
      const raw = request.postData();
      if (url.search || url.hash || typeof raw !== "string" || Buffer.byteLength(raw) > 32768)
        throw new Error();
      const envelope = fromJSON(JSON.parse(raw));
      if (
        !plain(envelope) ||
        Object.keys(envelope).some((key) => !["data", "context"].includes(key)) ||
        (envelope.context !== undefined &&
          (!plain(envelope.context) || Object.keys(envelope.context).length))
      )
        throw new Error();
      const data = envelope.data;
      if (
        !plain(data) ||
        Object.keys(data).some(
          (key) => !["name", "description", "system_prompt", "color"].includes(key),
        ) ||
        typeof data.name !== "string" ||
        !data.name.trim() ||
        data.name.trim().length > 100
      )
        throw new Error();
      for (const [key, limit] of [
        ["description", 1000],
        ["system_prompt", 4000],
        ["color", 24],
      ])
        if (
          data[key] !== undefined &&
          data[key] !== null &&
          (typeof data[key] !== "string" || data[key].trim().length > limit)
        )
          throw new Error();
    } catch {
      return error(400, "A bounded existing synthetic createProject payload is required.");
    }
    return error(
      503,
      "Synthetic project creation is unconfirmed. No project was created; checking Projects or acknowledging a retry only repeats this local inspection.",
    );
  };
}

export function createProjectRecoveryReviewHandler(
  scenario,
  account,
  functionNames,
  { isActive, dispatch },
) {
  validate(scenario, account);
  if (!scenario.startsWith("project-")) throw new Error("Project recovery scenario required.");
  const projectId = "33333333-3333-4333-8333-333333333333";
  const createdAt = "2026-10-16T10:00:00Z";
  const tasks = new Map(
    [
      ["Review the sample project brief", "todo", "2026-10-23"],
      ["Check the sample mobile layout", "todo", null],
      ["Compare the sample recovery messages", "doing", null],
      ["Prepare a synthetic review checklist", "done", null],
    ].map(([title, status, due_date], index) => {
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`;
      return [
        id,
        {
          id,
          project_id: projectId,
          title: `Sample · ${title}`,
          status,
          due_date,
          position: index + 1,
          completed_at: status === "done" ? createdAt : null,
          created_by: reviewOwner,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ];
    }),
  );
  const memories = new Map(
    [
      "Sample context: review this fictional project on phone and desktop widths. Use the same task labels so recovery is easy to follow.",
      "Sample review preference: keep the previous rows and unsaved draft visible after a simulated failure. No personal memory or provider is connected.",
    ].map((content, index) => {
      const id = `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, "0")}`;
      return [
        id,
        { id, project_id: projectId, content, created_by: reviewOwner, created_at: createdAt },
      ];
    }),
  );
  let memorySequence = 3;
  const failed = new Set();
  const reads = new Set(["listTasks", "listMemory"]);
  const mutations = new Set([
    "reorderTasks",
    "updateTask",
    "deleteTask",
    "addMemory",
    "deleteMemory",
    "removeMember",
    "revokeInvite",
  ]);
  const handled = new Set([...reads, ...mutations, "createTask"]);
  const fixtureRead = async (name) => {
    const entry = [...functionNames].find(([, value]) => value.split("_")[0] === name);
    if (!entry) throw new Error("The packaged project fixture contract is unavailable.");
    const data = name === "getProject" ? { id: projectId } : { project_id: projectId };
    const payload = encodeURIComponent(JSON.stringify(toJSON({ data, context: {} })));
    const response = await dispatch({
      url: `${origin}/_serverFn/${entry[0]}?payload=${payload}`,
      method: "GET",
    });
    if ((response.status ?? 200) !== 200 || !response.json || !("result" in response.json))
      throw new Error("The local project fixture could not be read.");
    return response.json.result;
  };
  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name =
      url.origin === origin && url.pathname.startsWith("/_serverFn/")
        ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
        : "";
    if (!handled.has(name)) return route.fallback();
    const error = (status, body) => route.fulfill({ status, contentType: "text/plain", body });
    const reply = (result) =>
      route.fulfill({ json: { result: structuredClone(result), context: {} } });
    if (
      !isActive() ||
      (request.headers()["x-kova-owner"] && request.headers()["x-kova-owner"] !== reviewOwner)
    )
      return error(401, "Synthetic project owner does not match this review session.");
    if (request.method() !== (reads.has(name) ? "GET" : "POST"))
      return error(405, "Unsupported synthetic project request method.");
    let data;
    try {
      const raw = request.method() === "GET" ? url.searchParams.get("payload") : request.postData();
      if (!raw || raw.length > 32768)
        return error(400, "A bounded synthetic project payload is required.");
      data = fromJSON(JSON.parse(raw))?.data;
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Invalid payload");
    } catch {
      return error(400, "Invalid synthetic project payload.");
    }
    // Match the real API shapes, but accept only this already-owned sample and
    // known rows. Invalid input must not consume a deterministic failure.
    const fields = {
      listTasks: ["project_id"],
      listMemory: ["project_id"],
      createTask: ["project_id", "title", "due_date"],
      reorderTasks: ["project_id", "order"],
      updateTask: ["id", "status"],
      deleteTask: ["id"],
      addMemory: ["project_id", "content"],
      deleteMemory: ["id"],
      removeMember: ["project_id", "user_id"],
      revokeInvite: ["id"],
    }[name];
    if (
      Object.keys(data).some((key) => !fields.includes(key)) ||
      (fields.includes("project_id") && data.project_id !== projectId)
    )
      return error(400, "Only the existing synthetic project contract is available.");
    try {
      const project = await fixtureRead("getProject");
      if (
        !project ||
        project.id !== projectId ||
        project.owner_id !== reviewOwner ||
        project.role !== "owner"
      )
        return error(403, "The existing synthetic project owner is required.");
      if (name === "createTask")
        return error(503, "Adding project tasks is outside this bounded recovery sample.");
      if (
        name === "updateTask" &&
        (!tasks.has(data.id) || !["todo", "doing", "done"].includes(data.status))
      )
        return error(400, "Choose an existing sample task and status.");
      if (name === "deleteTask" && !tasks.has(data.id)) return error(404, "Sample task not found.");
      if (name === "deleteMemory" && !memories.has(data.id))
        return error(404, "Sample memory not found.");
      if (
        name === "addMemory" &&
        (typeof data.content !== "string" ||
          !data.content.trim() ||
          data.content.trim().length > 2000)
      )
        return error(400, "Sample memory must contain 1–2000 characters.");
      if (name === "addMemory" && memorySequence > 16)
        return error(413, "This sample memory limit is reached. Reset the review.");
      if (
        name === "reorderTasks" &&
        (!Array.isArray(data.order) ||
          data.order.length !== tasks.size ||
          new Set(data.order).size !== tasks.size ||
          data.order.some((id) => !tasks.has(id)))
      )
        return error(400, "Reorder exactly the existing sample tasks, with no duplicate IDs.");
      if (name === "removeMember") {
        const members = await fixtureRead("listMembers");
        if (!members.some((member) => member.user_id === data.user_id && member.role !== "owner"))
          return error(400, "Choose an existing non-owner sample member.");
      }
      if (name === "revokeInvite") {
        const invites = await fixtureRead("listInvites");
        if (!invites.some((invite) => invite.id === data.id && invite.status === "pending"))
          return error(
            404,
            "Create a synthetic .invalid invitation before reviewing revoke recovery.",
          );
      }
      if (!isActive())
        return error(401, "Synthetic project session ended before this action completed.");
      const shouldFail =
        scenario === "project-list-recovery" ? reads.has(name) : mutations.has(name);
      if (shouldFail && !failed.has(name)) {
        failed.add(name);
        // Production reorder writes are sequential. Simulate one saved prefix
        // before the error so the normal reconciliation path sees saved state.
        if (name === "reorderTasks" && data.order.length) tasks.get(data.order[0]).position = 1;
        return error(
          503,
          `Simulated project ${name} failure. Retry locally; no provider is connected.`,
        );
      }
      if (name === "listTasks")
        return reply([...tasks.values()].sort((a, b) => a.position - b.position));
      if (name === "listMemory") return reply([...memories.values()].reverse());
      if (name === "updateTask")
        Object.assign(tasks.get(data.id), {
          status: data.status,
          completed_at: data.status === "done" ? createdAt : null,
        });
      if (name === "reorderTasks")
        data.order.forEach((id, index) => {
          tasks.get(id).position = index + 1;
        });
      if (name === "deleteTask") tasks.delete(data.id);
      if (name === "deleteMemory") memories.delete(data.id);
      if (name === "addMemory") {
        const id = `cccccccc-cccc-4ccc-8ccc-${String(memorySequence++).padStart(12, "0")}`;
        const row = {
          id,
          project_id: projectId,
          content: data.content.trim(),
          created_by: reviewOwner,
          created_at: createdAt,
        };
        memories.set(id, row);
        return reply(row);
      }
      // Reuse existing membership/invitation mutations, never invent success
      // for a target absent from their closed, session-local fixture records.
      if (name === "removeMember" || name === "revokeInvite") return route.fallback();
      return reply({ ok: true });
    } catch {
      return error(503, "The bounded synthetic project fixture is unavailable. Reset the review.");
    }
  };
}

// Exported for deterministic route-handler tests without a browser or server.
export function createReviewStateHandler(
  scenario,
  account,
  functionNames,
  now = Date.now(),
  options = {},
) {
  validate(scenario, account);
  let onboardingCompleted = false;
  let directoryReads = 0;
  let routeErrorReads = 0;
  const tasks =
    scenario === "tasks-editor" || scenario.startsWith("tasks-history-")
      ? createReviewTaskScenario(now)
      : null;
  const currentPeriodEnd = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const billing = {
    tier: account,
    effectiveTier: account,
    inherited: false,
    activeSubscriptionCount: 1,
    billingConflict: false,
    status: scenario.startsWith("billing-trial-")
      ? "trialing"
      : scenario === "billing-payment-past-due"
        ? "past_due"
        : "active",
    priceId: null,
    currentPeriodEnd,
    cancelAtPeriodEnd: scenario === "billing-trial-canceled",
    trialing: scenario.startsWith("billing-trial-"),
    hasBillingAccount: true,
    billingPortalAvailable: true,
  };
  return async (route) => {
    const url = new URL(route.request().url());
    const localFunction = url.origin === origin && url.pathname.startsWith("/_serverFn/");
    const name = localFunction
      ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    const reply = (result) => route.fulfill({ json: { result, context: {} } });
    if (
      (scenario === "route-error-recovery" && name === "listKnowledgeGraph") ||
      (scenario === "item313-timestamp-review" &&
        [
          "listAuditLog",
          "listNotifications",
          "markNotificationsRead",
          "deleteNotifications",
        ].includes(name))
    ) {
      const request = route.request();
      const fail = (status, error) => route.fulfill({ status, json: { error } });
      if (
        options.isActive?.() !== true ||
        (Object.hasOwn(request.headers(), "x-kova-owner") &&
          request.headers()["x-kova-owner"] !== reviewOwner)
      )
        return fail(401, "Synthetic read-only review account changed or does not match.");
      if (
        request.method() !== "GET" ||
        !["listAuditLog", "listNotifications", "listKnowledgeGraph"].includes(name)
      )
        return fail(405, "Synthetic review is read-only.");
      const raw = url.searchParams.get("payload");
      try {
        if (
          request.postData() ||
          [...url.searchParams.keys()].some((key) => key !== "payload") ||
          url.searchParams.getAll("payload").length > 1 ||
          (raw !== null && (!raw || Buffer.byteLength(raw) > 8192))
        )
          throw new Error();
        const value = raw === null ? {} : fromJSON(JSON.parse(raw));
        const plain = (v) =>
          v !== null &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          [Object.prototype, null].includes(Object.getPrototypeOf(v));
        if (
          !plain(value) ||
          Object.keys(value).some((key) => !["data", "context"].includes(key)) ||
          [value.data, value.context].some(
            (v) => v !== undefined && (!plain(v) || Object.keys(v).length),
          )
        )
          throw new Error();
      } catch {
        return fail(400, "Malformed bounded synthetic review read.");
      }
      const timestamp = "2026-10-17T19:05:00.000Z";
      if (scenario === "route-error-recovery") {
        routeErrorReads += 1;
        // Intentionally invalid display label, only once per disposable session.
        // The actual route throws during render; Retry remounts and reads valid data.
        return reply({
          nodes:
            routeErrorReads === 1
              ? [
                  {
                    id: "synthetic-route-error",
                    kind: "memory",
                    label: null,
                    href: "/knowledge-graph",
                    updatedAt: timestamp,
                  },
                ]
              : [],
          edges: [],
        });
      }
      return reply(
        name === "listAuditLog"
          ? [
              {
                id: "synthetic-activity-time",
                provider: "google",
                action: "read",
                status: "success",
                resource_id: null,
                summary: "Synthetic timestamp sample; no connected account accessed",
                created_at: timestamp,
              },
            ]
          : [
              {
                id: "77777777-7777-4777-8777-777777777777",
                source: "application",
                type: "review",
                title: "Synthetic timestamp sample",
                preview: "Read-only private review",
                actionUrl: null,
                readAt: timestamp,
                createdAt: timestamp,
              },
            ],
      );
    }
    if (
      scenario === "assistant-directory-recovery" &&
      url.origin === origin &&
      url.pathname === "/api/kovas/directory"
    ) {
      if (route.request().method() !== "GET")
        return route.fulfill({ status: 405, json: { error: "Read-only synthetic directory." } });
      directoryReads += 1;
      return route.fulfill(
        directoryReads === 1
          ? { status: 503, json: { error: "Synthetic directory failure" } }
          : { json: { rows: [] } },
      );
    }
    if (scenario === "picker-many-projects" && name === "listProjects") {
      if (route.request().method() !== "GET")
        return route.fulfill({ status: 405, json: { error: "Read-only synthetic projects." } });
      return reply(
        Array.from({ length: 9 }, (_, index) => ({
          id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
          name: `Sample project ${index + 1}`,
          description:
            "Synthetic selector review only. Project detail and execution are unavailable.",
          system_prompt: "Local review sample.",
          color: null,
          owner_id: reviewOwner,
          role: "owner",
          member_count: 1,
          chat_count: 0,
          file_count: 0,
          pinned_at: null,
          archived_at: null,
          deletion_requested_at: null,
          created_at: "2026-10-01T10:00:00Z",
          updated_at: "2026-10-16T10:00:00Z",
        })),
      );
    }
    if (scenario === "chat-sources-used" && name === "readMemorySources") {
      try {
        if (route.request().method() !== "GET")
          throw new Error("Read-only synthetic memory inspection.");
        const raw = url.searchParams.get("payload");
        const input = raw ? fromJSON(JSON.parse(raw))?.data : null;
        const ref = input?.sources?.[0];
        if (
          input?.ownerId !== reviewOwner ||
          input?.sources?.length !== 1 ||
          ref?.kind !== "chat_memory" ||
          ref?.id !== "66666666-6666-4666-8666-666666666666"
        )
          throw new Error("Only this synthetic memory reference is available.");
        return reply([
          {
            ...ref,
            available: true,
            title: "Sample memory · review fixture",
            content:
              "Synthetic saved context for this interface review. No personal memory was retrieved or changed.",
            truncated: false,
            updatedAt: "2026-10-18T00:00:00Z",
          },
        ]);
      } catch (error) {
        return route.fulfill({ status: 400, contentType: "text/plain", body: error.message });
      }
    }
    if (tasks && taskFunctions.has(name)) {
      try {
        if (
          scenario.startsWith("tasks-history-") &&
          !name.startsWith("list") &&
          name !== "isScheduledTasksEligible"
        )
          return route.fulfill({
            status: 405,
            json: { error: "Read-only synthetic last-run review. Task changes are unavailable." },
          });
        const result = tasks(name, route.request());
        if (name === "listScheduledTaskRuns" && scenario === "tasks-history-error")
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic last-run history unavailable. No run outcome is known." },
          });
        if (name === "listScheduledTaskRuns" && scenario === "tasks-history-empty")
          return reply([]);
        return reply(structuredClone(result));
      } catch (error) {
        return route.fulfill({ status: 400, contentType: "text/plain", body: error.message });
      }
    }
    if (scenario.startsWith("billing-")) {
      if (name === "getSubscriptionSummary") {
        if (scenario === "billing-unavailable")
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic billing status failure" },
          });
        return reply(billing);
      }
      if (name === "createPortalSession")
        return reply({ error: "The billing portal is unavailable in this synthetic review." });
    }
    if (scenario.startsWith("onboarding-")) {
      if (name === "getOnboarding")
        return reply({
          completed: onboardingCompleted,
          response_style: "balanced",
          primary_use: null,
          completed_at: null,
        });
      if (name === "saveOnboarding" || name === "skipOnboarding") {
        if (scenario === "onboarding-save-error")
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic onboarding persistence failure" },
          });
        onboardingCompleted = true;
        return reply({ ok: true });
      }
    }
    const ownedRecovery = url.origin === origin && url.pathname === "/api/auth/recovery/request";
    const legacyRecovery =
      url.protocol === "https:" &&
      /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) &&
      url.pathname === "/auth/v1/recover";
    if (
      scenario.startsWith("auth-recovery-") &&
      (ownedRecovery || legacyRecovery) &&
      route.request().method() === "POST"
    ) {
      return route.fulfill(
        scenario === "auth-recovery-sent"
          ? { json: {} }
          : { status: 503, json: { error: "Synthetic recovery request failure" } },
      );
    }
    return route.fallback();
  };
}

export async function installReviewState(page, scenario, account, options = {}) {
  const option = validate(scenario, account);
  if (
    (scenario === "route-error-recovery" ||
      scenario === "item313-timestamp-review" ||
      additionalHttpScenarios.has(scenario) ||
      scenario === "library-document-review" ||
      scenario === "account-loading" ||
      scenario === "account-plan-loading" ||
      scenario === "chat-many-history" ||
      scenario === "chat-stream-review" ||
      scenario === "font-load-failure" ||
      scenario === "accessibility-text-spacing" ||
      scenario === "chat-outputs" ||
      scenario === "chat-long-content" ||
      scenario === "chat-prose-numbering-review" ||
      scenario === "chat-trash" ||
      scenario.startsWith("chat-sources-") ||
      scenario.startsWith("project-")) &&
    options.adapter !== "http"
  )
    throw new Error(`${scenario} requires the ordinary private HTTP review adapter.`);
  if (
    additionalHttpScenarios.has(scenario) ||
    scenario === "default" ||
    scenario === "library-document-review" ||
    scenario === "account-loading" ||
    scenario === "account-plan-loading" ||
    scenario === "chat-many-history" ||
    scenario === "chat-stream-review" ||
    scenario === "font-load-failure" ||
    scenario === "accessibility-text-spacing" ||
    scenario === "chat-outputs" ||
    scenario === "chat-long-content" ||
    scenario === "chat-prose-numbering-review" ||
    scenario === "chat-trash" ||
    scenario === "chat-copy-task" ||
    scenario === "chat-task-unconfirmed" ||
    scenario.startsWith("project-")
  )
    return option;
  const names = scenario.startsWith("auth-recovery-") ? new Map() : readReviewFunctionNames();
  if (scenario.startsWith("onboarding-")) {
    // Returning-user base fixtures auto-dismiss onboarding. This scenario
    // intentionally exposes the actual dialog without modifying product code.
    await page.removeLocatorHandler(
      page.locator('[role="dialog"][data-state="open"]').filter({ hasText: "Welcome to KovaGPT" }),
    );
  }
  await page.route("**/*", createReviewStateHandler(scenario, account, names, Date.now(), options));
  return option;
}
