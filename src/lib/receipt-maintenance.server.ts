import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RECEIPT_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 500;
const RPC_TIMEOUT_MS = 10_000;

type MaintenanceClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

/** Purge only replay receipts; saved records, tombstones and audit events are retained. */
export async function runReceiptMaintenanceBatch(
  client: MaintenanceClient = supabaseAdmin as unknown as MaintenanceClient,
  now = Date.now(),
  timeoutMs = RPC_TIMEOUT_MS,
) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("receipt_maintenance_invalid");
  }
  const before = new Date(now - RECEIPT_RETENTION_MS).toISOString();
  const counts: Record<string, number> = {};
  for (const [key, rpc] of [
    ["work", "purge_work_sync_receipts"],
    ["projectTemplates", "purge_project_template_mutation_receipts"],
  ]) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("receipt_maintenance_timeout"));
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([
        client.rpc(rpc, { p_before: before, p_limit: BATCH_LIMIT }).abortSignal(controller.signal),
        deadline,
      ]);
      if (
        result.error ||
        typeof result.data !== "number" ||
        !Number.isSafeInteger(result.data) ||
        result.data < 0 ||
        result.data > BATCH_LIMIT
      ) {
        throw new Error("receipt_maintenance_failed");
      }
      counts[key] = result.data;
    } finally {
      clearTimeout(timer);
    }
  }
  return { removed: counts, batchLimit: BATCH_LIMIT, retentionDays: 8 };
}
