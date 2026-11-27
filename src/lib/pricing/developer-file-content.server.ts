import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expandDeveloperFileContent } from "./developer-file-policy.mjs";

type FileIdentity = {
  id: string;
  ownerId: string;
  project_id: string;
  capabilities: string[];
  db: SupabaseClient;
};

export async function readDeveloperFileRecords(identity: FileIdentity, ids: string[]) {
  if (!ids.length || ids.length > 4 || new Set(ids).size !== ids.length)
    throw new Error("developer_file_invalid");
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
      result.data.project_id !== identity.project_id ||
      typeof result.data.content !== "string" ||
      result.data.byte_size !== new TextEncoder().encode(result.data.content).length ||
      result.data.byte_size < 1 ||
      result.data.byte_size > 32768 ||
      !Number.isFinite(Date.parse(result.data.expires_at)) ||
      Date.parse(result.data.expires_at) <= Date.now() ||
      createHash("sha256").update(result.data.content).digest("hex") !== result.data.content_digest
    )
      throw new Error("developer_file_unavailable");
    files.push(result.data);
  }
  return files;
}

export async function loadDeveloperFileContent(
  identity: FileIdentity,
  body: Record<string, unknown>,
  ids: string[],
) {
  return expandDeveloperFileContent(
    body,
    ids.length ? await readDeveloperFileRecords(identity, ids) : [],
  );
}
