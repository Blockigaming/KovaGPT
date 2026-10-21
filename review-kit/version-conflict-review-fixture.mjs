// Private finite conflict scenarios. No service, authored-draft storage or successful save.
export const VERSION_CONFLICT_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const VERSION_CONFLICT_CHAT_ID = "c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0";
export const VERSION_CONFLICT_MESSAGE_ID = "version-conflict-answer";
export const VERSION_CONFLICT_DOCUMENT_ID = "d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0";
export const VERSION_CONFLICT_LIBRARY_ID = "e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0";
export const VERSION_CONFLICT_LIBRARY_GENERATION = "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0";
export const VERSION_CONFLICT_REVIEW_OPTIONS = Object.freeze([
  Object.freeze({
    id: "result-version-conflict",
    label: "result-version-conflict · draft retained, fixed newer sample",
    accounts: Object.freeze(["free", "plus", "pro"]),
    path: "/",
  }),
  Object.freeze({
    id: "library-version-conflict",
    label: "library-version-conflict · rejected save, draft retained",
    accounts: Object.freeze(["free", "plus", "pro"]),
    path: "/library",
  }),
]);
export const VERSION_CONFLICT_REVIEW_SCENARIOS = Object.freeze(
  VERSION_CONFLICT_REVIEW_OPTIONS.map(({ id }) => id),
);
export const VERSION_CONFLICT_REVIEW_DISCLOSURE =
  "Version-conflict scenarios use fictional fixed content and disposable local state. Open the Result writing sample and edit it: its first valid save returns 409/40001, then the existing refetch reads a fixed revision 2. Copy my draft and Load current version remain product controls; copying requires your explicit click. No authored draft is saved or echoed. The Library sample's first valid Save text as new version returns the normal 409 error and keeps the client draft while the fixed stored sample advances to revision 2. Retry never becomes a successful save. Select and copy any Library draft text to keep before explicitly resolving the dirty-close choice. Refresh Library, then reopen Versions to read the fixed current revision 2; reopening the stale revision-1 row is rejected by the product identity guard. Historical revision 1 remains readable. Reset re-arms the samples; sign-out/reset rejects stale requests. No real collaborator, Library version, backend write or provider is involved.";

const appOrigin = "http://127.0.0.1:4189";
const backendOrigin = "https://mfbycmbjygcfkrsuepxf.supabase.co";
const createdAt = "2026-10-19T09:00:00.000Z";
const updatedAt = "2026-10-19T09:01:00.000Z";
export const VERSION_CONFLICT_INITIAL_CONTENT = `# Fictional version conflict sample

This writing result is a fixed local review sample. It contains no real person, project or account information. Opening it reads synthetic revision 1; it does not contact a collaboration service.

## Inspect a preserved draft

Change one sentence in this editor and wait for its ordinary autosave attempt. The review adapter rejects the exact save with a version conflict. Your edited draft should remain visible while a fixed second revision is read independently.

## Choose a local recovery

Copy my draft copies only when you explicitly click it. Load current version replaces the working text with the fictional revision 2. Neither action saves your authored draft to a backend. Reset the review session to restore this original sample.
`;
export const VERSION_CONFLICT_CURRENT_CONTENT = `# Fictional current revision 2

This is the fixed newer sample returned after the rejected save. It was prepared with the review fixture, not written by a real collaborator.

## Review outcome

The earlier edited draft was never saved by the fixture. Loading this current version is an explicit local choice. Reset returns the fixture to revision 1.
`;
const libraryText =
  "Fictional Library version 1. Edit this local text, then Save text as new version to inspect a rejected 409 request. No authored draft is saved.";
export const VERSION_CONFLICT_LIBRARY_CURRENT_CONTENT =
  "Fictional Library current revision 2. This fixed newer text was prepared with the review fixture, not written by another person. Your rejected local draft was never saved. Historical revision 1 remains available.";
export function versionConflictConversation() {
  return {
    id: VERSION_CONFLICT_CHAT_ID,
    title: "Sample · Result version conflict",
    mode: "instant",
    createdAt: 1792396800000,
    updatedAt: 1792396800000,
    messages: [
      {
        id: "version-conflict-prompt",
        role: "user",
        content:
          "Inspect this fictional writing result's version-conflict controls. No live saves or provider calls.",
      },
      {
        id: VERSION_CONFLICT_MESSAGE_ID,
        role: "assistant",
        content: VERSION_CONFLICT_INITIAL_CONTENT,
      },
    ],
  };
}
export function versionConflictLibraryItem(revision = 1) {
  if (![1, 2].includes(revision)) throw new Error("Only fixed synthetic revisions 1 and 2 exist.");
  const content = revision === 1 ? libraryText : VERSION_CONFLICT_LIBRARY_CURRENT_CONTENT;
  return {
    id: VERSION_CONFLICT_LIBRARY_ID,
    user_id: VERSION_CONFLICT_REVIEW_OWNER,
    title: "Synthetic version-conflict notes",
    item_type: "document",
    source: "chat",
    content_text: content,
    content_excerpt: content,
    content_generation: VERSION_CONFLICT_LIBRARY_GENERATION,
    content_revision: revision,
    file_name: "synthetic-version-conflict.txt",
    file_type: "text/plain",
    file_url: null,
    file_size: Buffer.byteLength(content),
    folder_id: null,
    metadata: {},
    created_at: createdAt,
    updated_at: revision === 1 ? createdAt : updatedAt,
  };
}
export function installLibraryVersionConflictSample(items) {
  if (!Array.isArray(items) || items.some(({ id }) => id === VERSION_CONFLICT_LIBRARY_ID))
    throw new Error("Fresh synthetic Library state required.");
  const item = versionConflictLibraryItem();
  items.push(item);
  return item;
}
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, names) =>
  plain(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const json = (status, value) => ({ status, json: value, headers: { "Cache-Control": "no-store" } });

export function createVersionConflictReviewFixture(
  scenario,
  { isActive, expectedAccessToken, installedLibraryItem } = {},
) {
  if (
    !VERSION_CONFLICT_REVIEW_SCENARIOS.includes(scenario) ||
    typeof isActive !== "function" ||
    typeof expectedAccessToken !== "string" ||
    !expectedAccessToken
  )
    throw new Error(
      "Known conflict scenario, active synthetic session and pinned synthetic token required.",
    );
  let conflicted = false;
  let disposed = false;
  const ownsLibraryItem = () =>
    plain(installedLibraryItem) &&
    installedLibraryItem.id === VERSION_CONFLICT_LIBRARY_ID &&
    installedLibraryItem.user_id === VERSION_CONFLICT_REVIEW_OWNER &&
    installedLibraryItem.content_generation === VERSION_CONFLICT_LIBRARY_GENERATION &&
    installedLibraryItem.content_revision === (conflicted ? 2 : 1) &&
    installedLibraryItem.content_text ===
      (conflicted ? VERSION_CONFLICT_LIBRARY_CURRENT_CONTENT : libraryText);
  if (scenario === "library-version-conflict" && !ownsLibraryItem())
    throw new Error("The exact freshly installed synthetic Library item is required.");
  const snapshot = () => ({
    document: {
      id: VERSION_CONFLICT_DOCUMENT_ID,
      private_owner_id: VERSION_CONFLICT_REVIEW_OWNER,
      project_id: null,
      chat_id: VERSION_CONFLICT_CHAT_ID,
      message_id: VERSION_CONFLICT_MESSAGE_ID,
      content: conflicted ? VERSION_CONFLICT_CURRENT_CONTENT : VERSION_CONFLICT_INITIAL_CONTENT,
      revision: conflicted ? 2 : 1,
      comment_epoch: 0,
      updated_at: conflicted ? updatedAt : createdAt,
    },
    canEdit: true,
    canManageComments: false,
    deletedCommentIds: [],
    comments: [],
    versions: [
      ...(conflicted ? [{ revision: 2, created_at: updatedAt }] : []),
      { revision: 1, created_at: createdAt },
    ],
  });
  return {
    dispose() {
      disposed = true;
    },
    async handler(route) {
      const request = route.request();
      const url = new URL(request.url());
      const result =
        scenario === "result-version-conflict" &&
        url.origin === backendOrigin &&
        url.pathname === "/rest/v1/rpc/collaboration_rpc";
      const library =
        scenario === "library-version-conflict" &&
        url.origin === appOrigin &&
        url.pathname === "/api/library/items";
      if (!result && !library) return route.fallback();
      const fail = (status, error, code) =>
        route.fulfill(json(status, { error, ...(code ? { code } : {}) }));
      const headers = request.headers();
      if (
        disposed ||
        isActive() !== true ||
        headers.authorization !== `Bearer ${expectedAccessToken}` ||
        (Object.hasOwn(headers, "x-kova-owner") &&
          headers["x-kova-owner"] !== VERSION_CONFLICT_REVIEW_OWNER) ||
        (library && headers["x-kova-owner"] !== VERSION_CONFLICT_REVIEW_OWNER)
      )
        return fail(401, "Synthetic version-conflict account changed.", "42501");
      if (request.signal?.()?.aborted)
        return fail(499, "Synthetic conflict request canceled.", "cancelled");
      if (
        (result && request.method() !== "POST") ||
        (library && !["GET", "POST"].includes(request.method()))
      )
        return fail(405, "Unsupported synthetic conflict method.");
      if (url.hash || (request.method() === "POST" && url.search))
        return fail(400, "Use the exact synthetic conflict endpoint.");
      let body;
      if (request.method() === "POST") {
        const raw = request.postData();
        if (headers["content-type"]?.split(";", 1)[0] !== "application/json")
          return fail(415, "JSON is required.");
        if (typeof raw !== "string" || Buffer.byteLength(raw) > 2_000_000)
          return fail(413, "Synthetic conflict payload is too large.");
        try {
          body = JSON.parse(raw);
        } catch {
          return fail(400, "Invalid synthetic conflict payload.");
        }
      }
      if (result) {
        if (!keys(body, ["p_operation", "p_data"]))
          return fail(400, "Use the exact collaboration contract.");
        const { p_operation: operation, p_data: data } = body;
        if (operation === "open") {
          if (
            !keys(data, ["chatId", "messageId", "projectId", "content"]) ||
            data.chatId !== VERSION_CONFLICT_CHAT_ID ||
            data.messageId !== VERSION_CONFLICT_MESSAGE_ID ||
            data.projectId !== null ||
            data.content !== VERSION_CONFLICT_INITIAL_CONTENT
          )
            return fail(400, "Only the fixed synthetic Result can be opened.");
          return route.fulfill(json(200, snapshot()));
        }
        if (operation === "get") {
          if (!keys(data, ["documentId"]) || data.documentId !== VERSION_CONFLICT_DOCUMENT_ID)
            return fail(400, "Use the exact synthetic document identity.");
          return route.fulfill(json(200, snapshot()));
        }
        if (operation === "save") {
          if (
            !keys(data, ["documentId", "expectedRevision", "content"]) ||
            data.documentId !== VERSION_CONFLICT_DOCUMENT_ID ||
            ![1, ...(conflicted ? [2] : [])].includes(data.expectedRevision) ||
            typeof data.content !== "string" ||
            data.content.length > 400000
          )
            return fail(400, "Use the bounded synthetic Result save contract.");
          conflicted = true;
          return fail(409, "Synthetic version conflict; no draft was saved.", "40001");
        }
        if (operation === "get_version") {
          if (
            !keys(data, ["documentId", "revision"]) ||
            data.documentId !== VERSION_CONFLICT_DOCUMENT_ID ||
            ![1, ...(conflicted ? [2] : [])].includes(data.revision)
          )
            return fail(404, "Synthetic version unavailable.");
          return route.fulfill(
            json(200, {
              content:
                data.revision === 1
                  ? VERSION_CONFLICT_INITIAL_CONTENT
                  : VERSION_CONFLICT_CURRENT_CONTENT,
            }),
          );
        }
        if (operation === "presence" || operation === "leave") {
          if (
            !keys(data, ["kind", "resourceId", "sessionId", "sequence"]) ||
            data.kind !== "canvas" ||
            data.resourceId !== VERSION_CONFLICT_DOCUMENT_ID ||
            !uuid(data.sessionId) ||
            !Number.isSafeInteger(data.sequence) ||
            data.sequence < 1
          )
            return fail(400, "Use the bounded synthetic presence contract.");
          return route.fulfill(json(200, operation === "presence" ? { peers: 0 } : { ok: true }));
        }
        return fail(
          503,
          "Comments and other collaboration mutations are disconnected.",
          "unavailable",
        );
      }
      if (request.method() === "POST") {
        if (body?.operation === "list") return route.fallback();
        if (body?.operation !== "replace_text")
          return fail(503, "Library mutations are disconnected in this conflict sample.");
        if (
          !keys(body, ["operation", "id", "generation", "revision", "text"]) ||
          body.id !== VERSION_CONFLICT_LIBRARY_ID ||
          body.generation !== VERSION_CONFLICT_LIBRARY_GENERATION ||
          ![1, ...(conflicted ? [2] : [])].includes(body.revision) ||
          typeof body.text !== "string" ||
          Buffer.byteLength(body.text) > 300000
        )
          return fail(400, "Use the exact bounded synthetic Library revision.");
        if (!ownsLibraryItem())
          return fail(409, "Synthetic Library sample changed. Reset the review session.");
        if (!conflicted) {
          // Change only fixed sample fields visible to the existing CRUD list.
          // Never retain request text, and never return this mutable object.
          const current = versionConflictLibraryItem(2);
          for (const key of [
            "content_text",
            "content_excerpt",
            "content_revision",
            "file_size",
            "updated_at",
          ])
            installedLibraryItem[key] = current[key];
          conflicted = true;
        }
        return fail(409, "Library could not confirm this request. Refresh and try again.");
      }
      if (url.searchParams.get("id") !== VERSION_CONFLICT_LIBRARY_ID) return route.fallback();
      if (
        request.postData() ||
        [...url.searchParams.keys()].some(
          (key) =>
            !["id", "generation", "history", "revision"].includes(key) ||
            url.searchParams.getAll(key).length !== 1,
        ) ||
        url.searchParams.get("generation") !== VERSION_CONFLICT_LIBRARY_GENERATION ||
        (url.searchParams.has("history") && url.searchParams.get("history") !== "1") ||
        (url.searchParams.has("revision") &&
          !["1", ...(conflicted ? ["2"] : [])].includes(url.searchParams.get("revision"))) ||
        (url.searchParams.has("history") && url.searchParams.has("revision"))
      )
        return fail(400, "Use the exact synthetic Library history identity.");
      const revision = Number(url.searchParams.get("revision") ?? (conflicted ? 2 : 1));
      const item = versionConflictLibraryItem(revision);
      return route.fulfill(
        json(
          200,
          url.searchParams.get("history") === "1"
            ? {
                supported: true,
                versions: [conflicted ? 2 : 1, ...(conflicted ? [1] : [])].map((version) => {
                  const historical = versionConflictLibraryItem(version);
                  return {
                    kind: "text",
                    revision: version,
                    file_name: historical.file_name,
                    file_type: historical.file_type,
                    size_bytes: historical.file_size,
                    created_at: historical.updated_at,
                    current: version === (conflicted ? 2 : 1),
                  };
                }),
              }
            : item,
        ),
      );
    },
  };
}
