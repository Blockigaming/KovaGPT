export function cleanupAccountExportJobs(
  jobIds: string[],
  operations: {
    clear(jobId: string): Promise<void>;
    finalize(jobId: string): Promise<boolean>;
  },
): Promise<boolean>;

export function selectAccountExportCleanupIds(
  databaseIds: string[],
  storageIds: string[],
  limit: number,
): string[];
