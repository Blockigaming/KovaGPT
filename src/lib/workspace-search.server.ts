import { embeddingModel, embeddings } from "@/lib/ai/provider.server";
import { readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { embeddingRows } from "@/lib/workspace-search-policy.server.mjs";
export { embeddingModel as workspaceEmbeddingModel };
export function workspaceSemanticEnabled() {
  return (
    runtimeEnv("KOVA_WORKSPACE_SEMANTIC_ENABLED") === "true" &&
    Boolean(runtimeEnv("WORKSPACE_SEARCH_WORKER_SECRET")?.trim())
  );
}
export async function embedWorkspaceText(input: string[], parent?: AbortSignal) {
  if (input.length < 1 || input.length > 4 || input.some((text) => text.length > 8402))
    throw new Error("invalid_workspace_embedding_input");
  const signal = parent
    ? AbortSignal.any([parent, AbortSignal.timeout(20_000)])
    : AbortSignal.timeout(20_000);
  signal.throwIfAborted();
  const response = await embeddings(
    { model: embeddingModel(), input, dimensions: 1536 },
    { signal },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("workspace_embedding_unavailable");
  }
  const body = await readProviderJsonObject(response, 512 * 1024);
  signal.throwIfAborted();
  return embeddingRows(body, input.length);
}
export type WorkspaceSearchClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error?: unknown }> & {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error?: unknown }>;
  };
};
export function workspaceRpc(client: unknown, parent?: AbortSignal) {
  return (name: string, args: Record<string, unknown>) => {
    const signal = parent
      ? AbortSignal.any([parent, AbortSignal.timeout(6000)])
      : AbortSignal.timeout(6000);
    signal.throwIfAborted();
    return (client as WorkspaceSearchClient).rpc(name, args).abortSignal(signal);
  };
}
