export const WORKSPACE_EMBEDDING_DIMENSIONS: number;
export function validWorkspaceVector(value: unknown): value is number[];
export function embeddingRows(body: unknown, count: number): number[][];
export type WorkspaceSearchItem = {
  source_table: string;
  source_id: string;
  kind: string;
  title: string;
  snippet: string;
  href: string;
  project_id: string | null;
  updated_at: string;
  score: number;
  semantic: boolean;
};
export type WorkspaceSearchResult = {
  mode: "semantic_and_keyword" | "keyword";
  items: WorkspaceSearchItem[];
};
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error?: unknown }>;
type Embed = (input: string[]) => Promise<number[][]>;
export function searchWorkspace(input: {
  rpc: Rpc;
  embed: Embed;
  model: string;
  query: string;
  semanticAllowed: boolean;
}): Promise<WorkspaceSearchResult>;
export function processWorkspaceSearchJobs(input: {
  rpc: Rpc;
  embed: Embed;
  model: string;
}): Promise<{ claimed: number; completed: number; retrying: number; superseded: number }>;
