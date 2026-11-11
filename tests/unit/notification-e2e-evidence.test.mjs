import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_ACCEPTANCE_PROJECTS,
  verifiedEndToEndIds,
} from "../../src/lib/notification-acceptance-evidence.mjs";

const run = (projectName, status = "passed") => ({
  projectName,
  status: status === "passed" ? "expected" : "unexpected",
  results: [{ status }],
});
const spec = (file, title, tests) => ({ file, title, tests });
const report = (specs) => ({ suites: [{ title: "notification", specs }] });

test("a notification is certified only after actual desktop and phone browser passes", () => {
  const fixture = report([
    spec(
      "/repo/tests/e2e/notification-real-triggers.spec.ts",
      "[notice:network_offline][notice:network_restored] browser connection changes",
      NOTIFICATION_ACCEPTANCE_PROJECTS.map((project) => run(project)),
    ),
  ]);
  assert.deepEqual(
    [...verifiedEndToEndIds(fixture, ["network_offline", "network_restored"])].sort(),
    ["network_offline", "network_restored"],
  );
});

test("one-device passes, failures, skipped runs and fake event dispatch tests never certify", () => {
  const fixture = report([
    spec(
      "/repo/tests/e2e/notification-real-triggers.spec.ts",
      "[notice:network_offline] browser connection changes",
      [run("desktop-1440x900"), run("phone-390x844", "failed")],
    ),
    spec(
      "/repo/tests/e2e/notification-surfaces.spec.ts",
      "[notice:offer_claimed] synthetic notice dispatch",
      NOTIFICATION_ACCEPTANCE_PROJECTS.map((project) => run(project)),
    ),
    spec(
      "/repo/tests/e2e/notification-real-triggers.spec.ts",
      "[notice:unknown_event] nonexistent event",
      NOTIFICATION_ACCEPTANCE_PROJECTS.map((project) => run(project)),
    ),
  ]);
  assert.deepEqual(
    [...verifiedEndToEndIds(fixture, ["network_offline", "offer_claimed"])],
    [],
  );
});

test("no report, malformed results, or unrecognized project is never evidence", () => {
  assert.equal(verifiedEndToEndIds(null, ["network_offline"]).size, 0);
  assert.equal(
    verifiedEndToEndIds(
      report([
        spec(
          "/repo/tests/e2e/notification-real-triggers.spec.ts",
          "[notice:network_offline] test",
          [run("desktop-1280x800"), run("phone-390x844")],
        ),
      ]),
      ["network_offline"],
    ).size,
    0,
  );
});
