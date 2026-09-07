export const WORKSPACE_EMBEDDING_DIMENSIONS = 1536;
export function validWorkspaceVector(value) {
  return (
    Array.isArray(value) &&
    value.length === WORKSPACE_EMBEDDING_DIMENSIONS &&
    value.every(
      (item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 1e6,
    ) &&
    value.some((item) => item !== 0)
  );
}
export function embeddingRows(body, count) {
  if (!body || !Array.isArray(body.data) || body.data.length !== count)
    throw new Error("invalid_workspace_embedding");
  const vectors = new Array(count);
  for (const row of body.data) {
    if (
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= count ||
      vectors[row.index] ||
      !validWorkspaceVector(row.embedding)
    )
      throw new Error("invalid_workspace_embedding");
    vectors[row.index] = row.embedding;
  }
  return vectors;
}
function value(result) {
  if (!result || result.error) throw new Error("workspace_search_unavailable");
  return result.data;
}
export async function processWorkspaceSearchJobs({ rpc, embed, model }) {
  const jobs = value(await rpc("claim_workspace_search_jobs", { p_model: model }));
  if (!Array.isArray(jobs) || jobs.length > 4) throw new Error("invalid_workspace_claim");
  if (
    jobs.some(
      (job) =>
        typeof job.input_text !== "string" ||
        !job.input_text.trim() ||
        job.input_text.length > 8402,
    )
  )
    throw new Error("invalid_workspace_claim");
  let vectors = null;
  if (jobs.length) {
    try {
      vectors = await embed(jobs.map((job) => job.input_text));
      if (
        !Array.isArray(vectors) ||
        vectors.length !== jobs.length ||
        !vectors.every(validWorkspaceVector)
      )
        vectors = null;
    } catch {
      vectors = null;
    }
  }
  const result = { claimed: jobs.length, completed: 0, retrying: 0, superseded: 0 };
  for (const [index, job] of jobs.entries()) {
    const accepted = value(
      await rpc("settle_workspace_search_job", {
        p_id: job.id,
        p_revision: job.revision,
        p_lease: job.lease_token,
        p_model: model,
        p_embedding: vectors?.[index] ?? null,
      }),
    );
    if (accepted !== true) result.superseded++;
    else if (vectors) result.completed++;
    else result.retrying++;
  }
  return result;
}
export async function searchWorkspace({ rpc, embed, model, query, semanticAllowed }) {
  let embedding = null;
  if (semanticAllowed) {
    try {
      const vectors = await embed([query]);
      if (validWorkspaceVector(vectors?.[0])) embedding = vectors[0];
    } catch {
      /* Lexical search remains useful when provider capacity is unavailable. */
    }
  }
  let result = await rpc("search_workspace_sources", {
    p_query: query,
    p_embedding: embedding,
    p_model: model,
  });
  if (result?.error && embedding) {
    embedding = null;
    result = await rpc("search_workspace_sources", {
      p_query: query,
      p_embedding: null,
      p_model: null,
    });
  }
  const rows = value(result);
  if (!Array.isArray(rows) || rows.length > 30) throw new Error("invalid_workspace_results");
  return {
    mode:
      embedding && rows.some((row) => row.semantic === true) ? "semantic_and_keyword" : "keyword",
    items: rows,
  };
}
