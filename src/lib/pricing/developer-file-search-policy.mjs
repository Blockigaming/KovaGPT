const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => {
  throw new Error("developer_file_search_invalid");
};
const terms = (value) => value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function parseDeveloperFileSearch(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["query", "file_ids", "limit"].includes(key)) ||
    typeof input.query !== "string" ||
    input.query.length > 256 ||
    !Array.isArray(input.file_ids) ||
    input.file_ids.length < 1 ||
    input.file_ids.length > 4 ||
    input.file_ids.some((id) => typeof id !== "string" || !uuid.test(id))
  )
    fail();
  const fileIds = input.file_ids.map((id) => id.toLowerCase());
  const queryTerms = [...new Set(terms(input.query))];
  const limit = input.limit === undefined ? 5 : input.limit;
  if (
    new Set(fileIds).size !== fileIds.length ||
    queryTerms.length < 1 ||
    queryTerms.length > 12 ||
    queryTerms.some((term) => term.length > 64) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10
  )
    fail();
  return { query: input.query, terms: queryTerms, fileIds, limit };
}

// Explicit lexical retrieval, not embeddings or a hosted vector index.
// Bounded overlapping windows use Unicode code-point offsets. File contents
// are returned as plain data and are never executed or fetched as URLs.
export function searchDeveloperFileRecords(request, files, now = Date.now()) {
  if (!Array.isArray(files) || files.length !== request.fileIds.length) fail();
  const hits = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (
      file?.id !== request.fileIds[index] ||
      typeof file.filename !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.content_digest ?? "") ||
      typeof file.content !== "string" ||
      !Number.isSafeInteger(file.byte_size) ||
      file.byte_size !== new TextEncoder().encode(file.content).length ||
      file.byte_size < 1 ||
      file.byte_size > 32768 ||
      !Number.isFinite(Date.parse(file.expires_at)) ||
      Date.parse(file.expires_at) <= now
    )
      throw new Error("developer_file_unavailable");
    const characters = Array.from(file.content);
    for (let start = 0; start < characters.length; start += 400) {
      const end = Math.min(start + 480, characters.length);
      const snippet = characters.slice(start, end).join("");
      const words = terms(snippet);
      const frequencies = new Map();
      for (const word of words) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
      const matched = request.terms.filter((term) => frequencies.has(term));
      if (matched.length) {
        const score =
          matched.length * 10 +
          matched.reduce((sum, term) => sum + Math.min(3, frequencies.get(term)), 0);
        hits.push({
          file_id: file.id,
          filename: file.filename,
          content_digest: file.content_digest,
          start,
          end,
          score,
          snippet,
        });
      }
      if (end === characters.length) break;
    }
  }
  hits.sort(
    (a, b) => b.score - a.score || a.file_id.localeCompare(b.file_id) || a.start - b.start,
  );
  // Suppress overlapping duplicate snippets from the same file.
  const results = [];
  for (const hit of hits) {
    if (
      results.some(
        (previous) =>
          previous.file_id === hit.file_id &&
          Math.min(previous.end, hit.end) - Math.max(previous.start, hit.start) >= 80,
      )
    )
      continue;
    results.push(hit);
    if (results.length === request.limit) break;
  }
  return { object: "list", search_type: "lexical", offset_unit: "unicode_code_point", data: results };
}
