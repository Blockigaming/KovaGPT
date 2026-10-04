import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

export const OWNER_CHECKS = [
  "passkey_registration",
  "passkey_login_and_removal",
  "google_callback_and_consent",
];

export function acceptOwnerReceipt(run, receipt, now = Date.now()) {
  assert.equal(receipt.runId, run.runId);
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.receipts.length, 3);
  const rows = OWNER_CHECKS.map((check) => {
    const matches = receipt.receipts.filter((x) => x.check === check);
    assert.equal(matches.length, 1);
    const row = matches[0];
    assert.equal(row.kind, "DEPLOYED");
    assert.equal(row.status, "PASS");
    assert.equal(row.sourceSha, run.sourceSha);
    const at = Date.parse(row.at);
    assert.ok(at >= Date.parse(run.ownerFixture.createdAfter) && at <= now);
    assert.ok(at < run.ownerDeadline);
    return row;
  });
  run.records.push(...rows);
  run.save();
}

export async function executeS6(
  run,
  {
    manifest,
    relay,
    transition,
    realtime,
    clock = Date.now,
    pause = (ms) => new Promise((r) => setTimeout(r, ms)),
    publishInvitation = (path, invitation) =>
      writeFileSync(path, JSON.stringify(invitation, null, 2), { mode: 0o600, flag: "wx" }),
    progress = (event) => console.log(JSON.stringify(event)),
  },
) {
  let relayOpened = false,
    relayClosed = false;
  const failures = [];
  const closeRelay = async () => {
    if (relayOpened && !relayClosed) {
      await relay.call({ action: "close", runId: run.runId });
      relayClosed = true;
    }
  };
  try {
    const version = await run.app("/api/version");
    assert.equal(version.status, 200);
    assert.equal(version.data.sha, run.sourceSha, "unexpected deployed source");
    const preservedRealtime = manifest?.preservedRealtime;
    if (preservedRealtime) {
      assert.equal(preservedRealtime.check, "realtime_reauthorization");
      assert.equal(preservedRealtime.status, "PASS");
      assert.equal(preservedRealtime.kind, "DEPLOYED");
      if (preservedRealtime.sourceSha !== run.sourceSha) {
        // Realtime can survive the isolated private-download Request fix. Keep
        // the original receipt source and require the reviewed image-source diff.
        const reuse = manifest.preservedRealtimeReuse;
        assert.equal(reuse?.fromSourceSha, preservedRealtime.sourceSha);
        assert.equal(reuse?.toSourceSha, run.sourceSha);
        assert.deepEqual(reuse?.applicationChangedPaths, [
          "src/lib/kova-auth-private-download.server.ts",
        ]);
      }
      assert.match(preservedRealtime.runId, /^[a-f0-9]{12}$/);
      assert.ok(Number.isFinite(Date.parse(preservedRealtime.at)));
      assert.ok(Date.parse(preservedRealtime.at) <= clock());
      assert.ok(preservedRealtime.assertions.length > 0);
      run.records.push({
        ...preservedRealtime,
        kind: "REUSED_DEPLOYED",
        reusedForSourceSha: run.sourceSha,
      });
      run.save();
    }
    // Only unresolved checks run. Signup remains a preserved deployed PASS;
    // any new account creation below is disposable fixture setup, not a rerun.
    for (const [name, check] of [
      ["storage_revocation_and_url_lifetime", () => run.storageCheck()],
      ["realtime_reauthorization", () => realtime(run)],
    ]) {
      if (name === "realtime_reauthorization" && preservedRealtime) continue;
      progress({ check: name, status: "running" });
      await run.check(name, check);
    }
    if (run.records.some((r) => r.status === "FAIL" || r.status === "BLOCKED")) {
      for (const check of [...OWNER_CHECKS, "rollback_rehearsal"])
        run.records.push({
          check,
          status: "BLOCKED",
          kind: "DEPLOYED",
          reason: "automated prerequisites failed; restoration remains mandatory",
          at: new Date(clock()).toISOString(),
        });
      run.save();
      return;
    }
    if (manifest) {
      const baseline = run.prepareOwner(manifest.ownerEmail);
      baseline.expectedAccountId = await run.bootstrapOwner();
      run.ownerDeadline = baseline.deadline;
      const invitation = await relay.open(run.runId, baseline);
      relayOpened = true;
      publishInvitation(manifest.ownerInvitation, invitation);
      progress({
        ownerSessionReady: true,
        invitationFile: manifest.ownerInvitation,
        deadline: new Date(baseline.deadline).toISOString(),
      });
    }
    if (manifest) {
      const ownerEnd = Math.min(run.ownerDeadline, run.liveDeadline - 420000);
      let received = false,
        nextProgress = 0;
      while (clock() < ownerEnd) {
        const receipt = await relay.call();
        if (receipt.status === "complete") {
          acceptOwnerReceipt(run, receipt, clock());
          received = true;
          break;
        }
        if (receipt.status === "failed" || receipt.status === "empty") break;
        if (clock() >= nextProgress) {
          progress({
            ownerSession: receipt.status,
            remainingSeconds: Math.floor((ownerEnd - clock()) / 1000),
          });
          nextProgress = clock() + 30000;
        }
        await pause(2000);
      }
      if (!received) {
        for (const check of OWNER_CHECKS)
          run.records.push({
            check,
            kind: "DEPLOYED",
            status: "BLOCKED",
            sourceSha: run.sourceSha,
            at: new Date(clock()).toISOString(),
            reason: "owner_receipt_not_completed_in_reserved_window",
          });
        run.save();
      }
      // Remove the transfer channel before a revision transition loses its memory.
      await closeRelay();
      await run.check("rollback_rehearsal", async () => {
        await run.prepareRollbackFixture();
        await run.rollbackCheck(transition);
      });
    }
  } catch (error) {
    failures.push(error);
  } finally {
    // Each cleanup action is independent: a relay/API failure must never skip DB
    // cleanup or pinned restoration. No cleanup extends the live authorization.
    try {
      await closeRelay();
    } catch (error) {
      failures.push(error);
    }
    try {
      await run.cleanup();
    } catch (error) {
      failures.push(error);
    }
    try {
      if (manifest && !run.rollbackRestored) await transition("restore");
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "s6_execution_or_cleanup_failed");
}
