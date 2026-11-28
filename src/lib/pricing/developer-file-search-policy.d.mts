export type DeveloperFileSearchRequest = {
  query: string;
  terms: string[];
  fileIds: string[];
  limit: number;
};
export type DeveloperFileSearchHit = {
  file_id: string;
  filename: string;
  content_digest: string;
  start: number;
  end: number;
  score: number;
  snippet: string;
};
export function parseDeveloperFileSearch(input: unknown): DeveloperFileSearchRequest;
export function searchDeveloperFileRecords(
  request: DeveloperFileSearchRequest,
  files: Record<string, unknown>[],
  now?: number,
): {
  object: "list";
  search_type: "lexical";
  offset_unit: "unicode_code_point";
  data: DeveloperFileSearchHit[];
};
