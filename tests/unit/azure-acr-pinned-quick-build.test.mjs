import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ACR_RESOURCE_ID,
  ACR_API_VERSION,
  requestArmOnce,
  schedulePinnedAcrBuild,
} from "../../scripts/azure/acr-pinned-quick-build.mjs";

const sourceSha = "a".repeat(40);
const tag = `production-candidate-${sourceSha}-123-1`;
const token = "fixture-token-never-log-".repeat(3);
const url = (suffix) =>
  `https://management.azure.com${ACR_RESOURCE_ID}${suffix}?api-version=${ACR_API_VERSION}`;
function run(status = "Running", overrides = {}) {
  return {
    id: `${ACR_RESOURCE_ID}/runs/ca123`,
    properties: {
      runId: "ca123",
      status,
      agentConfiguration: { cpu: 2 },
      outputImages:
        status === "Succeeded"
          ? [
              {
                registry: "kovagptacr-dte9hugbhjghcyb8.azurecr.io",
                repository: "kovagpt-web",
                tag,
                digest: `sha256:${"b".repeat(64)}`,
              },
            ]
          : [],
      ...overrides,
    },
  };
}
function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "kova-acr-control-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    resourceId: ACR_RESOURCE_ID,
    token,
    budgetMs: 1_500_000,
    receiptPath: join(directory, "attempt.json"),
    body: {
      type: "DockerBuildRequest",
      agentConfiguration: { cpu: 2 },
      timeout: 1200,
      sourceLocation: `https://github.com/Blockigaming/KovaGPT.git#${sourceSha}`,
      imageNames: [`kovagpt-web:${tag}`],
    },
    ...overrides,
  };
}

test("one bound POST, CPU pin and sanitized durable evidence precede polling", async (t) => {
  const input = fixture(t);
  const calls = [];
  let clock = 0;
  const result = await schedulePinnedAcrBuild(input, {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    request: async (request) => {
      calls.push(request);
      const receipt = JSON.parse(readFileSync(input.receiptPath));
      assert.equal(receipt.authorizationConsumed, true);
      assert.equal(receipt.schedulePostAttempts, 1);
      assert.equal(receipt.sourceSha, sourceSha);
      assert.equal(receipt.tag, tag);
      assert.doesNotMatch(JSON.stringify(receipt), /fixture-token/u);
      return run(request.method === "POST" ? "Running" : "Succeeded");
    },
  });
  assert.equal(result.agentCpu, 2);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST", "GET"],
  );
  assert.equal(calls[0].body.agentConfiguration.cpu, 2);
  assert.equal(calls[0].body.timeout, 1200);
  assert.equal(input.token, undefined);
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.remoteOutcome, "Succeeded");
  assert.equal(receipt.remoteCleanupVerified, true);
});

for (const [label, agentConfiguration] of [
  ["omitted", undefined],
  ["empty", {}],
  ["null configuration", null],
  ["null cpu", { cpu: null }],
]) {
  test(`unreported ${label} submission and queued CPU stays unknown until GET reports 2`, async (t) => {
    const input = fixture(t);
    const calls = [];
    let clock = 0;
    let gets = 0;
    const result = await schedulePinnedAcrBuild(input, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      request: async (request) => {
        calls.push(request);
        if (calls.length > 1 && gets < 2) {
          const receipt = JSON.parse(readFileSync(input.receiptPath));
          assert.equal(receipt.requestedAgentCpu, 2);
          assert.equal(receipt.observedAgentCpu, null);
          assert.equal(receipt.cpuObservation, "unreported");
        }
        if (request.method === "POST") return run("Queued", { agentConfiguration });
        gets++;
        if (gets === 1) return run("Queued", { agentConfiguration });
        return run(gets === 2 ? "Running" : "Succeeded");
      },
    });
    assert.equal(result.agentCpu, 2);
    assert.deepEqual(
      calls.map((request) => request.method),
      ["POST", "GET", "GET", "GET"],
    );
    assert.equal(calls[0].body.agentConfiguration.cpu, 2);
    assert.equal(calls[0].body.timeout, 1200);
    const receipt = JSON.parse(readFileSync(input.receiptPath));
    assert.equal(receipt.observedAgentCpu, 2);
    assert.equal(receipt.cpuObservation, "verified");
    assert.equal(receipt.cpuObservationSource, "run-get");
    assert.equal(receipt.cancelPostAttempts, 0);
  });
}

test("a terminal-looking submission without CPU cannot bypass the authoritative GET", async (t) => {
  const input = fixture(t);
  const calls = [];
  const result = await schedulePinnedAcrBuild(input, {
    request: async (request) => {
      calls.push(request);
      return run("Succeeded", calls.length === 1 ? { agentConfiguration: undefined } : {});
    },
  });
  assert.deepEqual(
    calls.map((request) => request.method),
    ["POST", "GET"],
  );
  assert.equal(result.agentCpu, 2);
});

for (const [label, agentConfiguration] of [
  ["zero", { cpu: 0 }],
  ["one", { cpu: 1 }],
  ["four", { cpu: 4 }],
  ["fractional", { cpu: 2.5 }],
  ["string", { cpu: "2" }],
  ["nonfinite", { cpu: NaN }],
  ["array configuration", []],
  ["string configuration", "private provider text"],
]) {
  for (const phase of ["submission", "GET"]) {
    test(`${phase} explicit invalid ${label} CPU cancels only the owned run once`, async (t) => {
      const input = fixture(t);
      const calls = [];
      let cancelling = false;
      await assert.rejects(
        schedulePinnedAcrBuild(input, {
          request: async (request) => {
            calls.push(request);
            if (request.url.includes("/cancel?")) {
              cancelling = true;
              return null;
            }
            if (cancelling) return run("Canceled", { agentConfiguration });
            if (phase === "submission" || request.method === "GET")
              return run("Running", { agentConfiguration });
            return run("Queued");
          },
        }),
        /acr_cpu_mismatch/u,
      );
      assert.equal(calls.filter((request) => request.url.includes("/scheduleRun?")).length, 1);
      assert.equal(calls.filter((request) => request.url.includes("/cancel?")).length, 1);
      const receipt = JSON.parse(readFileSync(input.receiptPath));
      assert.equal(receipt.remoteOutcome, "Canceled");
      assert.equal(receipt.remoteCleanupVerified, true);
      assert.equal(receipt.cancelPostAttempts, 1);
      assert.equal(receipt.retries, 0);
      assert.notEqual(receipt.cpuObservation, "verified");
      assert.doesNotMatch(JSON.stringify(receipt), /private provider text/u);
    });
  }
}

for (const status of ["Started", "Running", "Succeeded"]) {
  test(`GET ${status} without CPU proof never qualifies the candidate`, async (t) => {
    const input = fixture(t);
    const calls = [];
    let cancelling = false;
    await assert.rejects(
      schedulePinnedAcrBuild(input, {
        request: async (request) => {
          calls.push(request);
          if (request.url.includes("/cancel?")) {
            cancelling = true;
            return null;
          }
          if (cancelling) return run("Canceled", { agentConfiguration: undefined });
          if (request.method === "POST") return run("Queued", { agentConfiguration: undefined });
          return run(status, { agentConfiguration: undefined });
        },
      }),
      /acr_cpu_unreported/u,
    );
    const receipt = JSON.parse(readFileSync(input.receiptPath));
    assert.equal(receipt.observedAgentCpu, null);
    assert.equal(receipt.cpuObservation, "unreported");
    assert.equal(receipt.remoteCleanupVerified, true);
    assert.equal(receipt.remoteOutcome, status === "Succeeded" ? "Succeeded" : "Canceled");
    assert.equal(receipt.cancelPostAttempts, status === "Succeeded" ? 0 : 1);
    assert.equal(calls.filter((request) => request.url.includes("/scheduleRun?")).length, 1);
  });
}

test("queued CPU omission with a start time is not treated as an unstarted queue", async (t) => {
  const input = fixture(t);
  let cancelling = false;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      request: async (request) => {
        if (request.url.includes("/cancel?")) {
          cancelling = true;
          return null;
        }
        if (cancelling) return run("Canceled");
        if (request.method === "POST") return run("Queued", { agentConfiguration: undefined });
        return run("Queued", { agentConfiguration: undefined, startTime: "2026-10-25T21:25:00Z" });
      },
    }),
    /acr_cpu_unreported/u,
  );
  assert.equal(JSON.parse(readFileSync(input.receiptPath)).cancelPostAttempts, 1);
});

test("earlier CPU2 observations cannot substitute for terminal GET CPU proof", async (t) => {
  const input = fixture(t);
  let calls = 0;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      sleep: async () => {},
      request: async () => {
        calls++;
        return run(
          calls < 3 ? "Running" : "Succeeded",
          calls === 3 ? { agentConfiguration: undefined } : {},
        );
      },
    }),
    /acr_cpu_unreported/u,
  );
  assert.equal(calls, 3);
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.remoteOutcome, "Succeeded");
  assert.equal(receipt.observedAgentCpu, null);
  assert.equal(receipt.cancelPostAttempts, 0);
});

test("terminal GET with wrong CPU proves stopped but never returns a qualified run", async (t) => {
  const input = fixture(t);
  let calls = 0;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      request: async () => {
        calls++;
        return run(
          calls === 1 ? "Queued" : "Succeeded",
          calls === 2 ? { agentConfiguration: { cpu: 4 } } : {},
        );
      },
    }),
    /acr_cpu_mismatch/u,
  );
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.remoteOutcome, "Succeeded");
  assert.equal(receipt.remoteCleanupVerified, true);
  assert.equal(receipt.observedAgentCpu, 4);
  assert.equal(receipt.cpuObservation, "mismatch");
  assert.equal(receipt.cancelPostAttempts, 0);
  assert.equal(calls, 2);
});

test("unreported queued CPU cannot reset the existing wall deadline", async (t) => {
  const input = fixture(t);
  let clock = 0;
  let submissions = 0;
  let cancelling = false;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      request: async (request) => {
        if (request.url.includes("/scheduleRun?")) submissions++;
        if (request.url.includes("/cancel?")) {
          cancelling = true;
          return null;
        }
        if (cancelling) return run("Canceled", { agentConfiguration: undefined });
        return run("Queued", { agentConfiguration: undefined });
      },
    }),
    /build_wall_budget_exhausted/u,
  );
  assert.equal(clock, 1_200_000);
  assert.equal(submissions, 1);
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.cancelPostAttempts, 1);
  assert.equal(receipt.remoteCleanupVerified, true);
  assert.equal(receipt.observedAgentCpu, null);
});

test("a late GET cannot extend the deadline even when it finally proves CPU2", async (t) => {
  const input = fixture(t);
  let clock = 0;
  let calls = 0;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      now: () => clock,
      request: async () => {
        calls++;
        if (calls === 1) return run("Queued", { agentConfiguration: undefined });
        clock = 1_200_001;
        return run("Succeeded");
      },
    }),
    /build_wall_budget_exhausted/u,
  );
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.remoteOutcome, "Succeeded");
  assert.equal(receipt.cancelPostAttempts, 0);
  assert.equal(calls, 2);
});

test("late preflight refuses submission without creating consumed receipt", async (t) => {
  const input = fixture(t, { budgetMs: 1_319_999 });
  let calls = 0;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      request: async () => {
        calls++;
      },
    }),
    /submission_budget_insufficient/u,
  );
  assert.equal(calls, 0);
  assert.equal(existsSync(input.receiptPath), false);
});

test("uncertain POST is consumed once, never repeated or blindly cancelled", async (t) => {
  const input = fixture(t);
  let calls = 0;
  const request = async () => {
    calls++;
    throw new Error("private token fixture");
  };
  await assert.rejects(schedulePinnedAcrBuild(input, { request }), {
    message: "production_candidate_build_reconciliation_failed",
  });
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.state, "CONSUMED_OUTCOME_UNCERTAIN");
  assert.equal(receipt.remoteCleanupVerified, false);
  assert.equal(receipt.cancelPostAttempts, 0);
  await assert.rejects(schedulePinnedAcrBuild({ ...input, token }, { request }));
  assert.equal(calls, 1);
});

test("budget exhaustion cancels only the identified run once with reserve remaining", async (t) => {
  const input = fixture(t);
  let clock = 0;
  const calls = [];
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      request: async (request) => {
        calls.push(request);
        if (request.url.endsWith(`/cancel?api-version=${ACR_API_VERSION}`)) {
          assert.ok(input.budgetMs - clock >= 120_000);
          const receipt = JSON.parse(readFileSync(input.receiptPath));
          assert.equal(receipt.cancelPostAttempts, 1);
          assert.equal(receipt.runId, "ca123");
          return null;
        }
        if (calls.some((call) => call.url.includes("/cancel?"))) return run("Canceled");
        return run("Queued");
      },
    }),
    /build_wall_budget_exhausted/u,
  );
  assert.equal(calls.filter((call) => call.url.includes("/scheduleRun?")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("/cancel?")).length, 1);
  assert.ok(
    calls.every((call) => call.url.startsWith(`https://management.azure.com${ACR_RESOURCE_ID}/`)),
  );
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.remoteOutcome, "Canceled");
  assert.equal(receipt.remoteCleanupVerified, true);
});

test("unknown cancellation/reconciliation is never certified as stopped", async (t) => {
  const input = fixture(t);
  let calls = 0;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      request: async () => {
        calls++;
        if (calls === 1) return run("Running", { agentConfiguration: { cpu: 4 } });
        throw new Error("private server response");
      },
    }),
    /acr_cpu_mismatch/u,
  );
  assert.equal(calls, 3);
  const receipt = JSON.parse(readFileSync(input.receiptPath));
  assert.equal(receipt.cancelPostAttempts, 1);
  assert.equal(receipt.remoteOutcome, "UNKNOWN");
  assert.equal(receipt.remoteCleanupVerified, false);
  assert.doesNotMatch(JSON.stringify(receipt), /private server response/u);
});

test("foreign run identity cannot be polled or cancelled", async (t) => {
  const input = fixture(t);
  let calls = 0;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      request: async () => {
        calls++;
        return { ...run(), id: `${ACR_RESOURCE_ID}other/runs/ca123` };
      },
    }),
    /acr_run_resource_mismatch/u,
  );
  assert.equal(calls, 1);
});

test("source/tag mismatch fails before dispatch", async (t) => {
  const input = fixture(t);
  input.body.sourceLocation = `https://github.com/Blockigaming/KovaGPT.git#${"b".repeat(40)}`;
  await assert.rejects(
    schedulePinnedAcrBuild(input, { request: async () => assert.fail("no dispatch") }),
    /source_tag_binding_invalid/u,
  );
  assert.equal(existsSync(input.receiptPath), false);
});

test("preexisting partial receipt is preserved", async (t) => {
  const input = fixture(t);
  writeFileSync(`${input.receiptPath}.next`, "prior evidence");
  let calls = 0;
  await assert.rejects(
    schedulePinnedAcrBuild(input, {
      request: async () => {
        calls++;
        return run();
      },
    }),
  );
  assert.equal(readFileSync(`${input.receiptPath}.next`, "utf8"), "prior evidence");
  assert.equal(calls, 0);
  assert.equal(existsSync(input.receiptPath), false);
});

function transportFixture(status, payload, inspect = () => {}) {
  return (target, options, callback) => {
    inspect(target, options);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () =>
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = status;
        response.destroy = () => {};
        callback(response);
        response.emit("data", Buffer.from(payload));
        response.emit("end");
      });
    return req;
  };
}

test("native transport rejects redirect without follow-up, retaining TLS", async () => {
  let calls = 0;
  await assert.rejects(
    requestArmOnce(
      { method: "POST", url: url("/scheduleRun"), token, body: {}, timeoutMs: 1000 },
      transportFixture(307, "private redirect response", (_target, options) => {
        calls++;
        assert.equal(options.rejectUnauthorized, true);
      }),
    ),
    { message: "production_candidate_arm_http_status_rejected" },
  );
  assert.equal(calls, 1);
});

test("native transport allows only exact resource paths and no cross-host authentication", async () => {
  for (const target of [
    url("/scheduleRun").replace("management.azure.com", "other.example"),
    url("/scheduleRun").replace("Microsoft.ContainerRegistry", "MicrosoftXContainerRegistry"),
    url("/runs/ca123/other"),
    `${url("/scheduleRun")}&extra=true`,
  ]) {
    await assert.rejects(
      requestArmOnce({ method: "POST", url: target, token, timeoutMs: 1000 }, () =>
        assert.fail("must not request"),
      ),
      /arm_target_invalid/u,
    );
  }
});

test("native transport accepts empty cancel body and caps response without raw diagnostics", async () => {
  assert.equal(
    await requestArmOnce(
      { method: "POST", url: url("/runs/ca123/cancel"), token, timeoutMs: 1000 },
      transportFixture(200, ""),
    ),
    null,
  );
  await assert.rejects(
    requestArmOnce(
      { method: "GET", url: url("/runs/ca123"), token, timeoutMs: 1000 },
      transportFixture(200, "x".repeat(1024 * 1024 + 1)),
    ),
    /arm_response_limit/u,
  );
  await assert.rejects(
    requestArmOnce(
      { method: "GET", url: url("/runs/ca123"), token, timeoutMs: 1000 },
      transportFixture(200, "private-invalid-json"),
    ),
    { message: "production_candidate_arm_response_invalid" },
  );
});

test("native timeout performs no transport retry", async () => {
  let calls = 0;
  await assert.rejects(
    requestArmOnce({ method: "POST", url: url("/scheduleRun"), token, timeoutMs: 2 }, () => {
      calls++;
      const request = new EventEmitter();
      request.end = () => {};
      request.destroy = () => {};
      return request;
    }),
    /arm_request_timeout/u,
  );
  assert.equal(calls, 1);
});
