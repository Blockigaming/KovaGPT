import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { WorkRun } from "@/lib/work-execution-protocol.mjs";

type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type WorkTables = {
  work_saved_records: Table<{
    id: string;
    owner_id: string;
    kind: string;
    revision: number;
    payload: Record<string, unknown>;
    deleted_at: string | null;
  }>;
  work_execution_runs: Table<{
    id: string;
    owner_id: string;
    request_id: string;
    request_hash: string;
    revision: number;
    status: string;
    state: WorkRun;
    created_at: string;
    updated_at: string;
  }>;
  work_execution_receipts: Table<{
    owner_id: string;
    mutation_id: string;
    mutation_hash: string;
    run_id: string;
    revision: number;
  }>;
  work_execution_outputs: Table<{
    id: string;
    owner_id: string;
    run_id: string;
    project_file_id: string;
    artifact_id: string;
    epoch: number;
    step_id: string;
    input_hash: string;
    sha256: string;
    size_bytes: number;
    mime_type: string;
  }>;
};
type WorkFunctions = {
  next_work_execution_dispatch: {
    Args: { p_runner_id: string; p_build: string };
    Returns: { owner_id: string; state: WorkRun } | null;
  };
  commit_work_execution: {
    Args: {
      p_owner_id: string;
      p_run_id: string;
      p_mutation_id: string;
      p_mutation_hash: string;
      p_expected_revision: number;
      p_state: WorkRun;
      p_runner_ready_until: string | null;
      p_concurrency: number;
    };
    Returns: { state: WorkRun; idempotent: boolean; appliedRevision: number };
  };
  assert_work_execution_lease: {
    Args: { p_owner_id: string; p_run_id: string; p_epoch: number; p_runner_id: string };
    Returns: boolean;
  };
  publish_work_execution_output: {
    Args: {
      p_owner_id: string;
      p_run_id: string;
      p_epoch: number;
      p_receipt_epoch: number;
      p_step_id: string;
      p_input_hash: string;
      p_project_file_id: string;
      p_artifact_id: string;
      p_sha256: string;
      p_size_bytes: number;
      p_mime_type: string;
    };
    Returns: { id: string; idempotent: boolean };
  };
  publish_work_project_file: {
    Args: WorkFunctions["publish_work_execution_output"]["Args"] & { p_attempt_id: string };
    Returns: boolean;
  };
};
type WorkDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & WorkTables;
    Functions: Database["public"]["Functions"] & WorkFunctions;
  };
};
export function workExecutionDatabase(client: unknown): SupabaseClient<WorkDatabase> {
  return client as SupabaseClient<WorkDatabase>;
}
