import assert from "node:assert/strict";
import test from "node:test";

import { cleanupAccountExportJobs } from "../../src/lib/account-export-cleanup-policy.mjs";

test("cleanup never finalizes retry metadata before object removal succeeds", async () => {
  const calls = [];
  await assert.rejects(
    cleanupAccountExportJobs(["job-1"], {
      clear: async (jobId) => {
        calls.push(`clear:${jobId}`);
        throw new Error("storage unavailable");
      },
      finalize: async (jobId) => {
        calls.push(`finalize:${jobId}`);
        return true;
      },
    }),
    /storage unavailable/u,
  );
  assert.deepEqual(calls, ["clear:job-1"]);
});

test("failed cleanup can be retried and only then finalized", async () => {
  let attempts = 0;
  const calls = [];
  const operations = {
    clear: async (jobId) => {
      attempts += 1;
      calls.push(`clear:${jobId}:${attempts}`);
      if (attempts === 1) throw new Error("storage unavailable");
    },
    finalize: async (jobId) => {
      calls.push(`finalize:${jobId}`);
      return true;
    },
  };

  await assert.rejects(cleanupAccountExportJobs(["job-1"], operations));
  assert.equal(await cleanupAccountExportJobs(["job-1"], operations), true);
  assert.deepEqual(calls, ["clear:job-1:1", "clear:job-1:2", "finalize:job-1"]);
});

test("cleanup deduplicates discovered database and storage job identifiers", async () => {
  const cleared = [];
  const finalized = [];
  assert.equal(
    await cleanupAccountExportJobs(["job-1", "job-1", "job-2"], {
      clear: async (jobId) => cleared.push(jobId),
      finalize: async (jobId) => {
        finalized.push(jobId);
        return true;
      },
    }),
    true,
  );
  assert.deepEqual(cleared, ["job-1", "job-2"]);
  assert.deepEqual(finalized, ["job-1", "job-2"]);
});
