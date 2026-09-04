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
