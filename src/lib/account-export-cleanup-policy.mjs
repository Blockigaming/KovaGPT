/**
 * Cleanup must complete before metadata is finalized. A thrown clear keeps the
 * durable path/worker evidence intact so the same operation can be retried.
 */
export async function cleanupAccountExportJobs(jobIds, operations) {
  for (const jobId of [...new Set(jobIds)]) {
    await operations.clear(jobId);
    const finalized = await operations.finalize(jobId);
    if (!finalized) return false;
  }
  return true;
}

/**
 * Prefer database-backed artifacts, then fill the bounded cleanup page with
 * orphaned Storage prefixes. Stable de-duplication keeps retries deterministic.
 */
export function selectAccountExportCleanupIds(databaseIds, storageIds, limit) {
  if (!Number.isInteger(limit) || limit < 1) return [];
  return [...new Set([...databaseIds, ...storageIds])].slice(0, limit);
}
