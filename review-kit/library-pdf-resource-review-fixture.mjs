import { readFileSync } from "node:fs";

// PRIVATE, finite local data. Bundled bytes only; no parser, storage or provider calls.
export const LIBRARY_PDF_RESOURCE_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const LIBRARY_PDF_RESOURCE_REVIEW_OPTION = Object.freeze({
  id: "library-pdf-resource-review",
  label: "library-pdf-resource-review · large page, page limit, CMap fidelity, valid blank",
  accounts: Object.freeze(["free", "plus", "pro"]),
  path: "/library",
});
export const LIBRARY_PDF_RESOURCE_REVIEW_DISCLOSURE =
  "library-pdf-resource-review appends four fictional read-only Library originals. The large valid page scales; the 101-page original exceeds the existing preview limit; the named-CMap original requires an unavailable resource. The current preview should report Preview unavailable rather than present its blank fallback as a faithful page. The first three records have separately authored synthetic saved text, which must remain accessible independently of original preview. The fourth is a valid two-page blank original with empty saved text; blank pixels and no text do not imply a preview failure. All Library server mutations are denied; Reset recreates the fixed samples. No upload, provider, remote resource or account storage is used.";
const origin = "http://127.0.0.1:4189";
const definitions = [
  [
    "large-mediabox",
    "Synthetic large MediaBox PDF",
    "The original has one valid 14400 by 14400 point page. The preview scales within its pixel cap.",
  ],
  [
    "101-page-limit",
    "Synthetic 101-page limit PDF",
    "The original deliberately has 101 pages. The existing 100-page preview limit rejects it; this separately saved text remains available.",
  ],
  [
    "unsupported-cmap",
    "Synthetic unavailable CMap PDF",
    "The original requires the unavailable 90ms-RKSJ-H CMap. The preview should report the unavailable resource; this separately saved text remains readable.",
  ],
  [
    "all-blank",
    "Synthetic valid blank PDF",
    "The original has two valid blank pages and no saved text.",
  ],
];
const ids = definitions.map((_, index) => `ab00000${index + 1}-abab-4bab-8bab-abababababab`);
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function installLibraryPdfResourceSamples(items) {
  if (!Array.isArray(items) || items.some((item) => ids.includes(item?.id)))
    throw new Error("Fresh synthetic Library state required.");
  const originals = new Map();
  const rows = definitions.map(([stem, title, description], index) => {
    const generation = `ac00000${index + 1}-acac-4cac-8cac-acacacacacac`;
    const file_name = `synthetic-${stem}.pdf`;
    const bytes = readFileSync(new URL(`./review-samples/pdf-pages/${file_name}`, import.meta.url));
    const content_text =
      stem === "all-blank"
        ? ""
        : `Fictional local review. Independently authored synthetic saved text, not a claim of extraction from this original. ${description} No account data, OCR or provider call is involved.`;
    const item = Object.freeze({
      id: ids[index],
      user_id: LIBRARY_PDF_RESOURCE_REVIEW_OWNER,
      title,
      item_type: "document",
      source: "upload",
      content_text,
      content_excerpt: content_text.slice(0, 100),
      content_generation: generation,
      content_revision: 1,
      original_generation: generation,
      file_name,
      file_type: "application/pdf",
      file_url: null,
      file_size: bytes.length,
      folder_id: null,
      metadata: Object.freeze({ file_bucket: "library-files", storage_generation: generation }),
      created_at: "2026-10-19T12:00:00.000Z",
      updated_at: "2026-10-19T12:00:00.000Z",
    });
    originals.set(item.id, { generation, bytes, item });
    return item;
  });
  items.push(...rows);
  return originals;
}
const libraryWrites = new Set([
  "renameLibrarySavedItem",
  "saveToLibrary",
  "deleteLibraryItem",
  "saveImageToLibrary",
  "deleteLibraryImage",
]);
function validList(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "cursor,favorites,filter,folder,operation,query,sort"
  )
    return false;
  return (
    body.operation === "list" &&
    typeof body.query === "string" &&
    body.query.length <= 200 &&
    ["newest", "oldest", "name", "size"].includes(body.sort) &&
    ["all", "favorites", "images", "documents", "other"].includes(body.filter) &&
    (["all", "unfiled"].includes(body.folder) || uuid(body.folder)) &&
    body.cursor === null &&
    typeof body.favorites === "string" &&
    body.favorites.length <= 7400 &&
    (body.favorites === "" || body.favorites.split(",").every(uuid))
  );
}
export function createLibraryPdfResourceReviewHandler(
  originals,
  { isActive, functionNames = new Map() },
) {
  if (
    !(originals instanceof Map) ||
    originals.size !== definitions.length ||
    typeof isActive !== "function" ||
    definitions.some(([stem], index) => {
      const sample = originals.get(ids[index]);
      return (
        sample?.item?.id !== ids[index] ||
        sample.item.user_id !== LIBRARY_PDF_RESOURCE_REVIEW_OWNER ||
        sample.generation !== `ac00000${index + 1}-acac-4cac-8cac-acacacacacac` ||
        sample.item.file_name !== `synthetic-${stem}.pdf` ||
        !Buffer.isBuffer(sample.bytes)
      );
    })
  )
    throw new Error("The fixed resource samples and active review session are required.");
  // Capture private copies so a caller cannot mutate returned response bytes or rows.
  const samples = new Map(
    [...originals].map(([id, value]) => [
      id,
      {
        generation: value.generation,
        bytes: Buffer.from(value.bytes),
        item: structuredClone(value.item),
      },
    ]),
  );
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const library = /^\/api\/library(?:\/|$)/.test(url.pathname);
    const server = /^\/_serverFn\/[^/]+$/.test(url.pathname);
    const backend =
      /^\/rest\/v1\/(?:user_library_[^/]+|rpc\/[^/]*library[^/]*)$/.test(url.pathname) ||
      url.pathname.startsWith("/storage/v1/");
    const name = server
      ? (functionNames.get(url.pathname.split("/").at(-1)) ?? "").split("_")[0]
      : "";
    if (!library && !server && !backend) return route.fallback();
    const fail = (status, error) =>
      route.fulfill({ status, json: { error }, headers: { "Cache-Control": "no-store" } });
    if (!backend && url.origin !== origin)
      return fail(400, "Use the local synthetic review origin.");
    const headers = request.headers();
    if (
      isActive() !== true ||
      (library
        ? headers["x-kova-owner"] !== LIBRARY_PDF_RESOURCE_REVIEW_OWNER
        : Object.hasOwn(headers, "x-kova-owner") &&
          headers["x-kova-owner"] !== LIBRARY_PDF_RESOURCE_REVIEW_OWNER)
    )
      return fail(401, "Synthetic PDF resource account changed.");
    if (request.signal?.()?.aborted) return fail(499, "Synthetic PDF resource read canceled.");
    if (backend || libraryWrites.has(name) || (server && method !== "GET"))
      return fail(
        405,
        "Read-only synthetic PDF review; server mutations and direct storage are unavailable.",
      );
    if (server) return route.fallback();
    if (method === "POST" && url.pathname === "/api/library/items") {
      if (url.search || url.hash)
        return fail(400, "Use the exact synthetic Library list endpoint.");
      if (headers["content-type"]?.split(";", 1)[0] !== "application/json")
        return fail(415, "JSON is required.");
      const raw = request.postData?.();
      if (typeof raw !== "string" || Buffer.byteLength(raw) > 8192)
        return fail(413, "Synthetic list payload is too large.");
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(400, "Invalid synthetic list payload.");
      }
      if (body?.operation !== "list")
        return fail(405, "Read-only synthetic PDF review; Library mutations are unavailable.");
      if (!validList(body)) return fail(400, "Use the bounded synthetic Library list read.");
      return route.fallback();
    }
    if (method !== "GET")
      return fail(405, "Read-only synthetic PDF review; Library mutations are unavailable.");
    if (!["/api/library/files", "/api/library/items"].includes(url.pathname))
      return route.fallback();
    const file = url.pathname.endsWith("/files"),
      id = url.searchParams.get("id"),
      generation = url.searchParams.get("generation");
    const keys = file ? ["id", "generation"] : ["id", "generation", "history", "revision"];
    if (
      url.hash ||
      request.postData?.() ||
      !uuid(id) ||
      !uuid(generation) ||
      [...url.searchParams.keys()].some(
        (key) => !keys.includes(key) || url.searchParams.getAll(key).length !== 1,
      ) ||
      (url.searchParams.has("history") && url.searchParams.get("history") !== "1") ||
      (url.searchParams.has("revision") &&
        !/^[1-9][0-9]{0,6}$/.test(url.searchParams.get("revision"))) ||
      (url.searchParams.has("history") && url.searchParams.has("revision"))
    )
      return fail(400, "Use the exact synthetic item and generation.");
    const sample = samples.get(id);
    if (!sample) return file ? fail(404, "Synthetic original unavailable.") : route.fallback();
    if (
      sample.generation !== generation ||
      (url.searchParams.has("revision") && url.searchParams.get("revision") !== "1")
    )
      return fail(404, "Synthetic original or saved text unavailable for this generation.");
    const headersOut = { "Cache-Control": "no-store" };
    if (file)
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from(sample.bytes),
        headers: headersOut,
      });
    return route.fulfill({
      status: 200,
      json: url.searchParams.has("history")
        ? { supported: false, versions: [] }
        : structuredClone(sample.item),
      headers: headersOut,
    });
  };
}
