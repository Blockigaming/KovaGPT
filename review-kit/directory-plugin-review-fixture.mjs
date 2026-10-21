import { fromJSON } from "seroval";

// PRIVATE REVIEW ONLY. Existing route/DTO shapes, with no provider, OAuth,
// database, production imports, publication, or connection state mutations.
const origin = "http://127.0.0.1:4189";
export const DIRECTORY_PLUGIN_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
const signedIn = ["free", "plus", "pro"];
const allAccounts = ["guest", ...signedIn];
export const DIRECTORY_PLUGIN_REVIEW_OPTIONS = Object.freeze(
  [
    {
      id: "assistant-directory-loading",
      label: "assistant-directory-loading · bounded public read hold",
      accounts: allAccounts,
      path: "/assistants",
    },
    {
      id: "assistant-directory-populated",
      label: "assistant-directory-populated · 23 synthetic cards, two pages",
      accounts: allAccounts,
      path: "/assistants",
    },
    {
      id: "assistant-directory-detail",
      label: "assistant-directory-detail · one synthetic card and read-only detail",
      accounts: allAccounts,
      path: "/assistants",
    },
    {
      id: "assistant-directory-next-page-error",
      label: "assistant-directory-next-page-error · retain first page, Retry recovers",
      accounts: allAccounts,
      path: "/assistants",
    },
    {
      id: "plugin-status-loading",
      label: "plugin-status-loading · actual Google / GitHub status reads",
      accounts: signedIn,
      path: "/apps",
    },
    {
      id: "plugin-status-error",
      label: "plugin-status-error · actual Google / GitHub status failures",
      accounts: signedIn,
      path: "/apps",
    },
    ...["expired", "partial", "healthy", "return-unverified", "return-verified"].map((state) => ({
      id: `plugin-health-${state}`,
      label: `plugin-health-${state} · synthetic status only, no authorization`,
      accounts: signedIn,
      path: state.startsWith("return-") ? "/apps?google_connected=1" : "/apps",
    })),
    ...[
      ["known", "two exact synthetic Gmail grant matches"],
      ["error", "dependency reads unavailable, Retry remains unavailable"],
      ["partial-empty", "no known matches within partial grant coverage"],
    ].map(([state, detail]) => ({
      id: `plugin-google-disconnect-${state}`,
      label: `plugin-google-disconnect-${state} · ${detail}`,
      accounts: signedIn,
      path: "/apps",
    })),
  ].map((option) => Object.freeze({ ...option, accounts: Object.freeze([...option.accounts]) })),
);
export const DIRECTORY_PLUGIN_REVIEW_SCENARIOS = Object.freeze(
  DIRECTORY_PLUGIN_REVIEW_OPTIONS.map(({ id }) => id),
);
export const DIRECTORY_PLUGIN_REVIEW_DISCLOSURE =
  "Provider-health samples are read-only fictional status DTOs. Expired retains account records; partial reports missing permissions; healthy reports only fixture status. Return variants simulate a URL return marker and bounded status read, never OAuth: unverified remains reconnect-required, verified returns only the healthy sample. No authorization, account selection or provider write can succeed. Assistant directory samples are explicitly synthetic interface records, not approved or live published assistants. The populated and next-page samples include the existing 21st-row pagination sentinel; the interface shows 20 cards, then three more. The next-page-error scenario fails the first next-page read; existing cards and the local search remain visible, and Retry returns the final three samples. Only assistant-directory-detail adds one exact synthetic card with its matching read-only non-owner detail for a signed-in synthetic account; Guest retains the ordinary sign-in gate. Its owned list and knowledge are empty, tools/apps are none and forking is disabled. The other directory scenarios still reject detail. No assistant is actually published: public visibility and version fields are required display DTO values only. Start a chat is an unchanged product control that may prepare a local draft, but chat requests and new account-history writes cannot succeed in this scenario. Custom-Kova writes, provider tools and OAuth are unavailable. The public directory uses its normal cookieless GET and exposes no account data. Plugin status loading/error samples hold or fail only the actual Google status and GitHub management reads; the 13-provider catalog remains static. Google disconnect samples display two fictional .invalid accounts using the existing status DTO. Open Disconnect for synthetic-google-primary@example.invalid, inspect the confirmation, then Cancel; do not confirm disconnection. Known returns two sample schedules joined through the exact active Gmail grant and account ID. Error keeps dependency checks unavailable, including Retry. Partial-empty omits that account's active task grant while retaining sample tasks: absence of known matches does not establish absence of dependencies. Coverage excludes expired/revoked grants and projects. The two task reads use their existing owner-bound POST Seroval contracts. No Google/provider/OAuth/disconnect or task mutation is supported, and no connection or task state changes. Pending reads use the adapter's bounded hold and may end earlier at the existing client's timeout; cancellation/reset never resumes a live read. No provider connection, authorization, publication or live-service result is established.";

const dependencyReads = new Set(["listScheduledTasks", "listScheduledTaskConnections"]);
const connectionId = (index) => `93939393-9393-4939-8939-${String(index).padStart(12, "0")}`;
const grantId = (index) => `94949494-9494-4949-8949-${String(index).padStart(12, "0")}`;
const taskId = (index) => `95959595-9595-4959-8959-${String(index).padStart(12, "0")}`;
const sampleTime = "2026-10-19T00:00:00.000Z";
const sampleScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
];
// Mirror getGoogleAccountsHealth / GoogleStatus, not the differently shaped
// summary getGoogleStatus server function. IDs and identities are fictional.
const googleAccounts = ["primary", "other"].map((label, index) => ({
  id: connectionId(index + 1),
  connectionRevision: 1,
  email: `synthetic-google-${label}@example.invalid`,
  connected: true,
  state: "connected",
  scopes: sampleScopes,
  has: { gmail: true, gmailWrite: true, calendar: true, calendarWrite: true, drive: true },
}));
const sampleGoogleStatus = {
  ...googleAccounts[0],
  accounts: googleAccounts,
  selectedConnectionId: connectionId(1),
  selectionRevision: 1,
};
function providerHealthSample(scenario) {
  const state =
    scenario.endsWith("expired") || scenario.endsWith("unverified")
      ? "reauthorization_required"
      : scenario.endsWith("partial")
        ? "permission_incomplete"
        : "connected";
  const account = {
    ...structuredClone(googleAccounts[0]),
    connected: state !== "reauthorization_required",
    state,
  };
  if (state === "permission_incomplete") {
    account.scopes = [sampleScopes[0]];
    account.has = {
      gmail: true,
      gmailWrite: false,
      calendar: false,
      calendarWrite: false,
      drive: false,
    };
  }
  return {
    google: {
      ...account,
      accounts: [account],
      selectedConnectionId: account.id,
      selectionRevision: 1,
    },
    github: {
      configured: true,
      accounts: [
        {
          id: connectionId(3),
          auth_type: "oauth",
          github_user_id: 123456789,
          login: "synthetic-review-account",
          avatar_url: null,
          status: state === "permission_incomplete" ? "degraded" : state,
          scopes: state === "permission_incomplete" ? ["read:user"] : ["read:user", "repo"],
          rate_limit: null,
          rate_remaining: null,
          rate_reset_at: null,
          last_health_at: sampleTime,
          last_refresh_at: sampleTime,
          token_expires_at:
            state === "reauthorization_required" ? "2020-01-01T00:00:00.000Z" : null,
          created_at: sampleTime,
        },
      ],
      installations: [],
      repositories: [],
      health:
        state === "reauthorization_required"
          ? "reconnect_required"
          : state === "permission_incomplete"
            ? "degraded"
            : "healthy",
    },
  };
}
const sampleTaskConnections = {
  connections: googleAccounts.map((account, index) => ({
    id: account.id,
    provider: "gmail",
    label: account.email,
    requiredScopes: [sampleScopes[0]],
    generation: grantId(10 + index),
    account: `synthetic-google-sub-${index + 1}`,
  })),
  grants: ["gmail", "gmail", "github"].map((provider, index) => ({
    id: grantId(index + 1),
    provider,
    connection_ref: connectionId(index + 1),
    expires_at: "2099-01-01T00:00:00.000Z",
  })),
};
const context = (index, provider = "gmail") => ({
  kind: "connected",
  provider,
  grantId: grantId(index),
  resource: provider === "gmail" ? "abcdef01" : "synthetic-review/example",
});
const trigger = (index) => ({ provider: "gmail", grantId: grantId(index), resource: "inbox" });
const dependencyTasks = [
  ["Synthetic inbox digest · sample only", [context(1)], [trigger(1)]],
  ["Synthetic mail alert · sample only", [], [trigger(1)]],
  ["Synthetic other-account mail · sample only", [context(2)], []],
  ["Synthetic GitHub context · sample only", [context(3, "github")], []],
  ["Synthetic inactive Gmail grant · sample only", [context(4)], []],
].map(([title, context_refs, event_triggers], index) => ({
  id: taskId(index + 1),
  title,
  prompt: "Synthetic interface record only. No task runs and no provider is contacted.",
  run_at: sampleTime,
  repeat: "none",
  status: "paused",
  last_run_at: null,
  next_run_at: null,
  last_result: null,
  created_at: sampleTime,
  updated_at: sampleTime,
  revision: 1,
  timezone: "UTC",
  schedule_local: sampleTime.slice(0, 19),
  trigger_mode: event_triggers.length ? "event" : "time",
  context_refs,
  event_triggers,
  last_error: null,
}));

const cardId = (index) => `91919191-9191-4919-8919-${String(index).padStart(12, "0")}`;
export const DIRECTORY_REVIEW_NEXT_CURSOR = cardId(20);
const sampleCards = Array.from({ length: 23 }, (_, index) => ({
  id: cardId(index + 1),
  owned: false,
  revision: 1,
  // The production card DTO needs this value to represent a directory row.
  // Both its visible title/description and the controller disclose the fiction.
  visibility: "public",
  blocked: false,
  version_id: `92929292-9292-4929-8929-${String(index + 1).padStart(12, "0")}`,
  config: {
    name: `Synthetic review assistant ${String(index + 1).padStart(2, "0")} · ${["Writing", "Planning", "Study"][index % 3]}`,
    icon: "Sample only",
    description:
      "Synthetic interface sample only. Not a published assistant; detail, chat, tools and provider access are unavailable.",
    starters: [],
    mode: "instant",
    tools: [],
    apps: [],
    allowFork: false,
  },
}));
export const DIRECTORY_REVIEW_DETAIL_ID = cardId(1);
const detailCard = {
  ...sampleCards[0],
  config: {
    ...sampleCards[0].config,
    description:
      "Synthetic read-only directory/detail sample only. Not a published assistant. Chat, tools, apps, forking, reporting and provider access are disconnected.",
  },
};
// read_custom_kovas deliberately omits instructions and config.knowledge for
// non-owners. Do not fill those private fields merely to satisfy the broad TS type.
const detailView = {
  id: detailCard.id,
  owned: false,
  revision: detailCard.revision,
  visibility: detailCard.visibility,
  blocked: false,
  versionId: detailCard.version_id,
  publicationVersion: detailCard.version_id,
  config: detailCard.config,
  knowledge: [],
};
const plainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const emptyObject = (value) => plainObject(value) && Object.keys(value).length === 0;

// getGitHubManagement has no input validator/data fields. Accept its no-input
// GET and the transport's empty Seroval envelope, never arbitrary account IDs.
function validManagementRead(url, request) {
  if ([...url.searchParams.keys()].some((key) => key !== "payload")) return false;
  if (request.postData()) return false;
  if (!url.searchParams.has("payload")) return true;
  if (url.searchParams.getAll("payload").length !== 1) return false;
  const raw = url.searchParams.get("payload");
  if (!raw || Buffer.byteLength(raw) > 4096) return false;
  try {
    const envelope = fromJSON(JSON.parse(raw));
    return (
      plainObject(envelope) &&
      Object.keys(envelope).every((key) => ["data", "context"].includes(key)) &&
      (envelope.data === undefined || emptyObject(envelope.data)) &&
      (envelope.context === undefined || emptyObject(envelope.context))
    );
  } catch {
    return false;
  }
}

function dependencyOwner(url, request) {
  if (url.search) return null;
  const raw = request.postData();
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > 4096) return null;
  try {
    const envelope = fromJSON(JSON.parse(raw));
    if (
      !plainObject(envelope) ||
      Object.keys(envelope).some((key) => !["data", "context"].includes(key)) ||
      (envelope.context !== undefined && !emptyObject(envelope.context)) ||
      !plainObject(envelope.data) ||
      Object.keys(envelope.data).length !== 1 ||
      !Object.hasOwn(envelope.data, "expectedUserId") ||
      typeof envelope.data.expectedUserId !== "string"
    )
      return null;
    return envelope.data.expectedUserId;
  } catch {
    return null;
  }
}

/** Register after the base fixtures for /api/** and /_serverFn/*.
 * Directory GET is deliberately anonymous: the HTTP adapter must also dispatch
 * cookieless /api/kovas/directory requests to this active disposable handler.
 * isActive means the review session still exists, including guest sessions;
 * plugin options additionally require the selected synthetic signed-in account.
 * wait(signal) is owned/disposed by the parent; this module creates no timers.
 */
export function createDirectoryPluginReviewHandler(
  scenario,
  account,
  functionNames,
  { isActive, wait },
) {
  const option = DIRECTORY_PLUGIN_REVIEW_OPTIONS.find(({ id }) => id === scenario);
  if (!option || !option.accounts.includes(account))
    throw new Error("Choose an eligible synthetic directory or Plugin status scenario.");
  if (typeof isActive !== "function" || typeof wait !== "function")
    throw new Error("Directory / Plugin review requires its session lifetime and bounded wait.");
  const directory = scenario.startsWith("assistant-directory-");
  const directoryDetail = scenario === "assistant-directory-detail";
  const dependencies = scenario.startsWith("plugin-google-disconnect-");
  const healthReview = scenario.startsWith("plugin-health-");
  if (
    !directory &&
    ![...functionNames.values()].some((value) => value.split("_")[0] === "getGitHubManagement")
  )
    throw new Error("The packaged Plugin contract is missing getGitHubManagement.");
  if (dependencies)
    for (const name of dependencyReads)
      if (![...functionNames.values()].some((value) => value.split("_")[0] === name))
        throw new Error(`The packaged Google dependency contract is missing ${name}.`);
  let failedNextPage = false;

  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const name = /^\/_serverFn\/[^/]+$/.test(url.pathname)
      ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    const kovaPath = /^\/api\/(?:kovas|admin\/kovas)(?:\/|$)/.test(url.pathname);
    const providerPath =
      /^\/api\/(?:google|github)(?:\/|$)/.test(url.pathname) ||
      ((dependencies || directoryDetail || healthReview) &&
        /^\/api\/(?:auth\/google|internal\/(?:google-oauth-cleanup|scheduled-execution))(?:\/|$)/.test(
          url.pathname,
        ));
    const providerFunction =
      /github/i.test(name) ||
      ((dependencies || directoryDetail || healthReview) && /google|gmail|calendar/i.test(name));
    const scheduleFunction = dependencies && /ScheduledTask/.test(name);
    const blockedChat = directoryDetail && /^\/api\/chat(?:\/|$)/.test(url.pathname);
    if (
      !(directory
        ? kovaPath || providerPath || providerFunction || blockedChat
        : providerPath || providerFunction || scheduleFunction)
    )
      return route.fallback();
    const reply = (body, status = 200) =>
      route.fulfill({ status, headers: { "Cache-Control": "no-store" }, json: body });
    const error = (message, status = 503) => reply({ error: message }, status);
    if (isActive() !== true)
      return error("Synthetic directory / Plugin review session has ended. Reset the review.", 401);
    if (request.signal?.()?.aborted)
      return error("Synthetic directory / Plugin read was canceled.", 499);

    const hold = async (label) => {
      let reason;
      try {
        reason = await wait(request.signal?.());
      } catch {
        return error(`Synthetic ${label} hold is unavailable. Reset the review.`);
      }
      if (
        isActive() !== true ||
        request.signal?.()?.aborted ||
        ["aborted", "reset", "disposed"].includes(reason)
      )
        return error(`Synthetic ${label} loading inspection canceled.`, 499);
      return error(
        reason === "capacity"
          ? `Synthetic ${label} loading request limit reached. Reset to continue.`
          : `Synthetic ${label} loading hold ended. Reset to inspect again; no live read ran.`,
      );
    };

    if (directory) {
      if (directoryDetail && url.pathname === "/api/kovas") {
        if (
          account === "guest" ||
          request.headers()["x-kova-owner"] !== DIRECTORY_PLUGIN_REVIEW_OWNER
        )
          return error("The matching signed-in synthetic account is required for detail.", 401);
        if (request.method() !== "GET")
          return error("Synthetic Kova detail is read-only; all mutations are disconnected.", 405);
        const scope = url.searchParams.get("scope");
        const keys = [...url.searchParams.keys()];
        if (
          request.postData() ||
          !["owned", "read"].includes(scope) ||
          keys.some((key) => !(scope === "owned" ? ["scope"] : ["scope", "id"]).includes(key)) ||
          url.searchParams.getAll("scope").length !== 1 ||
          (scope === "read" && url.searchParams.getAll("id").length !== 1)
        )
          return error("Use the exact empty owned-list or one-card detail read.", 400);
        if (scope === "owned") return reply({ rows: [] });
        if (url.searchParams.get("id") !== DIRECTORY_REVIEW_DETAIL_ID)
          return error("Only the selected synthetic directory card is available.", 404);
        return reply(structuredClone(detailView));
      }
      if (url.pathname !== "/api/kovas/directory")
        return error(
          directoryDetail
            ? "Synthetic directory detail supports only its bounded list/detail reads; chat, provider and write operations are unavailable."
            : "Synthetic directory supports only its card list; detail, provider and write operations are unavailable.",
        );
      if (request.method() !== "GET") return error("Read-only synthetic directory.", 405);
      if (directoryDetail) {
        if (url.search || request.postData())
          return error("The one-card synthetic directory has no cursor or query inputs.", 400);
        return reply({ rows: [structuredClone(detailCard)] });
      }
      if (
        request.postData() ||
        [...url.searchParams.keys()].some((key) => key !== "after") ||
        url.searchParams.getAll("after").length > 1 ||
        (url.searchParams.has("after") &&
          url.searchParams.get("after") !== DIRECTORY_REVIEW_NEXT_CURSOR)
      )
        return error("Choose the existing synthetic directory page cursor.", 400);
      if (scenario === "assistant-directory-loading") return hold("assistant directory");
      const nextPage = url.searchParams.has("after");
      if (scenario === "assistant-directory-next-page-error" && nextPage && !failedNextPage) {
        failedNextPage = true;
        return error(
          "Synthetic next-page read failed. Retry preserves the loaded sample cards and search.",
        );
      }
      return reply({
        rows: structuredClone(nextPage ? sampleCards.slice(20) : sampleCards.slice(0, 21)),
      });
    }

    if (scheduleFunction) {
      if (!dependencyReads.has(name))
        return error(
          "Synthetic Google dependency review permits only its two task reads; task mutations and execution are unavailable.",
        );
      // These are read-only operations declared POST by scheduled-tasks.functions.
      if (request.method() !== "POST")
        return error("Use the existing synthetic task read method.", 405);
      const headers = request.headers();
      if (
        Object.hasOwn(headers, "x-kova-owner") &&
        headers["x-kova-owner"] !== DIRECTORY_PLUGIN_REVIEW_OWNER
      )
        return error("Synthetic task account does not match this review session.", 401);
      const expectedOwner = dependencyOwner(url, request);
      if (expectedOwner === null)
        return error("A bounded existing task read payload is required.", 400);
      if (expectedOwner !== DIRECTORY_PLUGIN_REVIEW_OWNER)
        return error("Synthetic task account does not match this review session.", 401);
      if (scenario === "plugin-google-disconnect-error")
        return error(
          "Synthetic schedule dependencies could not be checked. Retry remains local and unavailable.",
        );
      const result = structuredClone(
        name === "listScheduledTasks" ? dependencyTasks : sampleTaskConnections,
      );
      if (
        name === "listScheduledTaskConnections" &&
        scenario === "plugin-google-disconnect-partial-empty"
      )
        result.grants = result.grants.filter((grant) => grant.id !== grantId(1));
      return reply({ result, context: {} });
    }

    const google = url.pathname === "/api/google/status";
    const github = name === "getGitHubManagement";
    if (!google && !github)
      return error(
        "Synthetic Plugin review permits status reads only; provider and OAuth operations are unavailable.",
      );
    if (request.method() !== "GET") return error("Read-only synthetic Plugin status.", 405);
    const headers = request.headers();
    if (
      (google && headers["x-kova-owner"] !== DIRECTORY_PLUGIN_REVIEW_OWNER) ||
      (Object.hasOwn(headers, "x-kova-owner") &&
        headers["x-kova-owner"] !== DIRECTORY_PLUGIN_REVIEW_OWNER)
    )
      return error("Synthetic Plugin status account does not match this review session.", 401);
    if (google ? url.search || request.postData() : !validManagementRead(url, request))
      return error("A bounded existing Plugin status read is required.", 400);
    if (healthReview) {
      if (google && scenario.includes("-return-")) {
        let reason;
        try {
          reason = await wait(request.signal?.());
        } catch {
          return error("Synthetic provider return read unavailable.");
        }
        if (
          isActive() !== true ||
          request.signal?.()?.aborted ||
          ["aborted", "reset", "disposed"].includes(reason)
        )
          return error("Synthetic provider return read canceled.", 499);
        if (!["expired", "released"].includes(reason))
          return error("Synthetic provider return hold unavailable.");
      }
      const sample = providerHealthSample(scenario);
      return reply(google ? sample.google : { result: sample.github, context: {} });
    }
    if (dependencies)
      return reply(
        google
          ? structuredClone(sampleGoogleStatus)
          : {
              result: {
                configured: false,
                accounts: [],
                installations: [],
                repositories: [],
                health: "credentials_not_configured",
              },
              context: {},
            },
      );
    const label = google ? "Google status" : "GitHub management status";
    return scenario === "plugin-status-loading"
      ? hold(label)
      : error(`Synthetic ${label} read failed. Refresh retries only this disposable fixture.`);
  };
}
