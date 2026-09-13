import { removeNulCharacters } from "@/lib/sanitize-text";
// Server-only helpers for project knowledge indexing + retrieval (RAG).
// Uses the configured direct embedding provider through the server-side AI adapter.

import { embeddingModel, embeddings, providerErrorFromResponse } from "@/lib/ai/provider.server";

const EMBED_DIMS = 1536;

// Chunking: ~1200 chars with ~200 char overlap.
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_FILE = 200;

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/x-ndjson",
  "application/javascript",
  "application/typescript",
  "application/csv",
  "application/sql",
]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "xml",
  "log",
  "ini",
  "env",
  "conf",
  "cfg",
  "toml",
  "sql",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "php",
  "sh",
  "bash",
  "zsh",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "vue",
  "svelte",
  "r",
  "lua",
  "pl",
  "ex",
  "exs",
]);

export function isTextIndexable(mime: string | null | undefined, name: string): boolean {
  const m = (mime ?? "").toLowerCase();
  if (m && (TEXT_MIME_PREFIXES.some((p) => m.startsWith(p)) || TEXT_MIME_EXACT.has(m))) return true;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

function chunkText(text: string): string[] {
  const clean = removeNulCharacters(text).replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length && chunks.length < MAX_CHUNKS_PER_FILE) {
    const end = Math.min(clean.length, i + CHUNK_SIZE);
    let slice = clean.slice(i, end);
    // Try to cut on a paragraph/sentence boundary near the end.
    if (end < clean.length) {
      const softCut = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
      );
      if (softCut > CHUNK_SIZE * 0.5) {
        slice = slice.slice(0, softCut);
      }
    }
    const trimmed = slice.trim();
    if (trimmed) chunks.push(trimmed);
    i += Math.max(1, slice.length - CHUNK_OVERLAP);
  }
  return chunks;
}

async function embedBatch(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
  signal?.throwIfAborted();
  const resp = await embeddings(
    { model: embeddingModel(), input: inputs, dimensions: EMBED_DIMS },
    { signal },
  );
  signal?.throwIfAborted();
  if (!resp.ok) throw await providerErrorFromResponse(resp);
  const json = (await resp.json()) as { data?: Array<{ index: number; embedding: number[] }> };
  signal?.throwIfAborted();
  const out: number[][] = new Array(inputs.length);
  for (const row of json.data ?? []) out[row.index] = row.embedding;
  return out;
}

async function embedOne(text: string, signal?: AbortSignal): Promise<number[] | null> {
  const [v] = await embedBatch([text], signal);
  return v ?? null;
}

type Supa = {
  storage: {
    from: (b: string) => {
      download: (p: string) => Promise<{ data: Blob | null; error: unknown }>;
    };
  };
  from: (t: string) => {
    delete: () => { eq: (c: string, v: unknown) => Promise<{ error: unknown }> };
    insert: (rows: Record<string, unknown>[]) => Promise<{ error: unknown }>;
    rpc?: unknown;
  };
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

/**
 * Index a project file: downloads it via storage, extracts text (only for
 * text-indexable MIMEs/extensions), chunks, embeds, and inserts rows.
 * Best-effort — logs and returns { indexed: false } on failure.
 */
export async function indexProjectFile(params: {
  supabaseAdmin: Supa;
  project_id: string;
  file_id: string;
  storage_path: string;
  name: string;
  mime_type: string | null;
}): Promise<{ indexed: boolean; chunks: number; reason?: string }> {
  const { supabaseAdmin, project_id, file_id, storage_path, name, mime_type } = params;
  if (!isTextIndexable(mime_type, name)) {
    return { indexed: false, chunks: 0, reason: "unsupported_type" };
  }
  try {
    const dl = await supabaseAdmin.storage.from("project-files").download(storage_path);
    if (dl.error || !dl.data) return { indexed: false, chunks: 0, reason: "download_failed" };
    const text = await dl.data.text();
    const chunks = chunkText(text);
    if (chunks.length === 0) return { indexed: false, chunks: 0, reason: "empty" };

    // Clear any prior chunks for this file (re-index safe).
    await supabaseAdmin.from("project_file_chunks").delete().eq("file_id", file_id);

    // Embed in batches of 64 (well under provider caps).
    const BATCH = 64;
    for (let b = 0; b < chunks.length; b += BATCH) {
      const slice = chunks.slice(b, b + BATCH);
      const vectors = await embedBatch(slice);
      const rows = slice.map((content, i) => ({
        project_id,
        file_id,
        chunk_index: b + i,
        content,
        embedding: vectors[i] as unknown as string,
      }));
      const { error } = await supabaseAdmin.from("project_file_chunks").insert(rows);
      if (error) throw error;
    }
    return { indexed: true, chunks: chunks.length };
  } catch (e) {
    console.error("[indexProjectFile]", (e as Error)?.message ?? e);
    return { indexed: false, chunks: 0, reason: "error" };
  }
}

/**
 * Retrieve top-k relevant chunks for a natural language query in a project.
 * Uses the SECURITY DEFINER match_project_chunks RPC (RLS-checked inside).
 */
export async function retrieveProjectContext(params: {
  supabase: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }> & {
      abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
  project_id: string;
  query: string;
  k?: number;
  signal?: AbortSignal;
}): Promise<Array<{ file_id: string; content: string; similarity: number }>> {
  const q = params.query.trim();
  if (!q) return [];
  try {
    const vec = await embedOne(q.slice(0, 4000), params.signal);
    params.signal?.throwIfAborted();
    if (!vec) return [];
    const query = params.supabase.rpc("match_project_chunks", {
      _project_id: params.project_id,
      query_embedding: vec as unknown as string,
      match_count: Math.max(1, Math.min(params.k ?? 6, 12)),
    });
    const { data, error } = await (params.signal ? query.abortSignal(params.signal) : query);
    params.signal?.throwIfAborted();
    if (error) {
      console.warn("[retrieveProjectContext] rpc", error);
      return [];
    }
    return (data as Array<{ file_id: string; content: string; similarity: number }>) ?? [];
  } catch (e) {
    if (params.signal?.aborted) return [];
    console.warn("[retrieveProjectContext]", (e as Error)?.message ?? e);
    return [];
  }
}
