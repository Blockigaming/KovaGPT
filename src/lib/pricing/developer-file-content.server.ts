import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expandDeveloperFileContent } from "./developer-file-policy.mjs";

export async function loadDeveloperFileContent(
  identity: {
    id: string;
    ownerId: string;
    project_id: string;
    capabilities: string[];
    db: SupabaseClient;
  },
  body: Record<string, unknown>,
  ids: string[],
) {
  if (!ids.length) return expandDeveloperFileContent(body, []);
  if (!identity.capabilities.includes("files")) throw new Error("developer_scope_required");
  const files: Record<string, unknown>[] = [];
  // At most four bounded reads; each RPC rechecks owner, project, key and deletion under the account lock.
  for (const id of ids) {
    const result = await identity.db
      .rpc("manage_developer_files", {
        p_owner: identity.ownerId,
        p_key: identity.id,
        p_project: identity.project_id,
        p_operation: "get",
        p_input: { id },
      })
      .abortSignal(AbortSignal.timeout(10000));
    if (result.error || !result.data || result.data.id !== id)
      throw new Error("developer_file_unavailable");
    if (
      typeof result.data.content !== "string" ||
      createHash("sha256").update(result.data.content).digest("hex") !== result.data.content_digest
    )
      throw new Error("developer_file_unavailable");
    files.push(result.data);
  }
  return expandDeveloperFileContent(body, files);
}
