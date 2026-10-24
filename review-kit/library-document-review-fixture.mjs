// PRIVATE, disposable review data. No provider, storage upload or database write.
export const LIBRARY_DOCUMENT_REVIEW_OWNER = "22222222-2222-4222-8222-222222222222";
export const HISTORICAL_MISSING_REVIEW_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const LIBRARY_DOCUMENT_REVIEW_DISCLOSURE =
  "library-document-review adds two synthetic local PDFs to the disposable Library: a two-page original and a deliberately invalid original. Preview and extracted text are separate. Original downloads use only bundled fictional bytes; nothing is uploaded or fetched from a provider. Reset discards local title changes and selections.";

export function syntheticReviewPdf() {
  const streams = [1, 2].map(
    (page) =>
      `BT /F1 18 Tf 40 220 Td (Synthetic review page ${page}) Tj 0 -32 Td /F1 11 Tf (Fictional local document. No account records.) Tj ET`,
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 280] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 280] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}

export function installLibraryDocumentSamples(items) {
  const originals = new Map();
  for (const [index, title] of ["Synthetic two-page document", "Synthetic invalid PDF"].entries()) {
    const id = `d${index + 1}dddddd-dddd-4ddd-8ddd-dddddddddddd`;
    const generation = `e${index + 1}eeeeee-eeee-4eee-8eee-eeeeeeeeeeee`;
    const bytes =
      index === 0
        ? syntheticReviewPdf()
        : Buffer.from("%PDF-1.4\nDeliberately invalid synthetic preview sample.");
    const text =
      index === 0
        ? "[Page 1]\nSynthetic review page 1\nFictional local document. No account records.\n\n[Page 2]\nSynthetic review page 2\nFictional local document. No account records."
        : "Synthetic retained extracted text. The original preview is deliberately invalid.";
    items.push({
      id,
      user_id: LIBRARY_DOCUMENT_REVIEW_OWNER,
      title,
      item_type: "document",
      source: "upload",
      content_text: text,
      content_excerpt: text.slice(0, 100),
      content_generation: generation,
      content_revision: 1,
      original_generation: generation,
      file_name: `${index ? "invalid" : "two-page"}-sample.pdf`,
      file_type: "application/pdf",
      file_url: null,
      file_size: bytes.length,
      folder_id: null,
      metadata: { file_bucket: "library-files", storage_generation: generation },
      created_at: "2026-10-16T10:00:00Z",
      updated_at: "2026-10-17T11:00:00Z",
    });
    originals.set(id, { generation, bytes });
  }
  return originals;
}

export function createLibraryDocumentReviewHandler(originals, { isActive }) {
  return async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4189" || url.pathname !== "/api/library/files")
      return route.fallback();
    const fail = (status, error) =>
      route.fulfill({ status, json: { error }, headers: { "Cache-Control": "no-store" } });
    if (!isActive() || request.headers()["x-kova-owner"] !== LIBRARY_DOCUMENT_REVIEW_OWNER)
      return fail(401, "Synthetic document account changed.");
    if (request.method() !== "GET")
      return fail(405, "Read-only bundled document preview; upload and mutation are unavailable.");
    if (request.signal?.()?.aborted) return fail(499, "Synthetic document read canceled.");
    if (
      [...url.searchParams.keys()].some((key) => !["id", "generation"].includes(key)) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.getAll("generation").length !== 1
    )
      return fail(400, "Use the exact synthetic document identity.");
    const item = originals.get(url.searchParams.get("id"));
    if (!item || item.generation !== url.searchParams.get("generation"))
      return fail(404, "Synthetic original unavailable for this identity.");
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: item.bytes,
      headers: { "Cache-Control": "no-store" },
    });
  };
}

export function createHistoricalLibraryReviewHandler({ isActive, getItems }) {
  return async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname !== "/rest/v1/user_library_items") return route.fallback();
    const fail = (status, message) =>
      route.fulfill({ status, json: { message }, headers: { "Cache-Control": "no-store" } });
    if (!isActive()) return fail(401, "Synthetic account changed.");
    if (request.method() !== "GET")
      return fail(405, "Read-only synthetic historical attachment check.");
    if (request.signal?.()?.aborted) return fail(499, "Synthetic read canceled.");
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    if (
      url.searchParams.get("select") !== "id,user_id" ||
      url.searchParams.get("user_id") !== `eq.${LIBRARY_DOCUMENT_REVIEW_OWNER}` ||
      !/^eq\.[0-9a-f-]{36}$/i.test(url.searchParams.get("id") ?? "") ||
      [...url.searchParams.keys()].some((key) => !["select", "id", "user_id"].includes(key)) ||
      [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
    )
      return fail(400, "Use the exact synthetic owner and attachment identity.");
    const item = getItems().find(
      (value) => value.id === id && value.user_id === LIBRARY_DOCUMENT_REVIEW_OWNER,
    );
    return route.fulfill({
      status: 200,
      json: item ? [{ id: item.id, user_id: item.user_id }] : [],
      headers: { "Cache-Control": "no-store" },
    });
  };
}
