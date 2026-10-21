import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as principal from "../../src/lib/principal-browser-storage.mjs";
import * as policy from "../../src/lib/account-export-policy.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const artifact = "44444444-4444-4444-8444-444444444444";
const fixedNow = Date.parse("2026-10-18T23:00:00Z");
const job = (status = "queued", extra = {}) => ({
  id,
  status,
  requestedAt: new Date(fixedNow).toISOString(),
  completedAt: null,
  expiresAt: null,
  sizeBytes: null,
  failureCode: null,
  downloadable: false,
  cleanupPending: false,
  ...extra,
});
const complete = () =>
  job("complete", {
    completedAt: new Date(fixedNow + 20000).toISOString(),
    expiresAt: new Date(fixedNow + 3600000).toISOString(),
    sizeBytes: 4096,
    downloadable: true,
  });
const privateUrl = () =>
  `/api/private-files?kind=export&owner=${owner}&id=${id}&version=${"a".repeat(64)}`;

function helperFixture() {
  const values = new Map();
  const state = { denied: false, writeDenied: false, now: fixedNow };
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (state.writeDenied) throw Error("blocked");
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [state.now]));
    }
    static now() {
      return state.now;
    }
  }
  const ui = loadUiModule(
    "src/lib/account-export-ui.ts",
    {
      "@/lib/principal-browser-storage.mjs": {
        ...principal,
        safeBrowserStorage: () => (state.denied ? null : storage),
      },
      "@/lib/account-export-policy.mjs": policy,
    },
    { Date: FakeDate, URL },
  );
  return { ui, state, values, FakeDate };
}

function clientFixture(helper = helperFixture()) {
  const calls = [];
  const state = { owner, result: { job: null }, status: 200, retryAfter: null, fail: false };
  const client = loadUiModule(
    "src/lib/account-export-client.ts",
    {
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => ({
              data: { session: { user: { id: state.owner }, access_token: "fixture-token" } },
            }),
          },
        },
      },
      "@/integrations/supabase/config": {
        SUPABASE_BROWSER_CONFIG: { url: "https://storage.example.test" },
      },
      "@/lib/endpoint-reliability.mjs": reliability,
      "@/lib/account-export-policy.mjs": policy,
      "./account-export-ui": helper.ui,
    },
    {
      Date: helper.FakeDate,
      AbortSignal,
      TextDecoder,
      window: { location: { origin: "https://kova.test" } },
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (state.fail) throw Error("network");
        return Response.json(state.result, {
          status: state.status,
          headers: state.retryAfter ? { "Retry-After": state.retryAfter } : {},
        });
      },
    },
  );
  return { helper, client, state, calls };
}

test("status parsing is bounded and does not manufacture metadata, progress, or failure detail", () => {
  const { ui } = helperFixture();
  for (const status of ["queued", "processing", "complete", "failed", "canceled", "expired"])
    assert.equal(ui.parseAccountExportJob(job(status)).status, status);
  assert.equal(ui.parseAccountExportJob(null), null);
  for (const value of [undefined, {}, [], job("invented"), job("complete", { id: "bad" })])
    assert.throws(() => ui.parseAccountExportJob(value));
  const parsed = ui.parseAccountExportJob(
    job("failed", {
      sizeBytes: -1,
      failureCode: "private secret detail",
      completedAt: "unknown",
      downloadable: true,
    }),
  );
  assert.equal(parsed.sizeBytes, null);
  assert.equal(parsed.completedAt, null);
  assert.equal(parsed.failureCode, null);
  assert.equal(parsed.downloadable, false);
  assert.equal(ui.exportStatusLabel(complete(), fixedNow + 3600001), "Expired");
  assert.equal(ui.exportRequestWaitSeconds(job(), fixedNow), 43200);
  assert.equal(
    ui.exportRequestWaitSeconds(
      job("failed", { failureCode: "account_export_audit_failed" }),
      fixedNow,
    ),
    0,
  );
  assert.equal(ui.exportRequestWaitSeconds(job("failed", { requestedAt: null }), fixedNow), null);
});

test("request markers are principal-scoped, bounded, durable across remount and fail closed", () => {
  const f = helperFixture();
  assert.equal(f.ui.readExportRequestMarker(owner).kind, "none");
  const first = f.ui.beginExportRequestMarker(owner, null);
  assert.equal(first.created, true);
  assert.equal(f.ui.beginExportRequestMarker(owner, null).created, false);
  assert.equal(f.ui.readExportRequestMarker(other).kind, "none");
  const [key, raw] = [...f.values][0];
  assert.equal(key, principal.principalScopedStorageKey("kova-account-export-request", owner));
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["previousJobId", "startedAt"]);
  assert.equal(f.ui.clearExportRequestMarker(owner).kind, "none");
  for (const value of [
    "x".repeat(201),
    "{",
    JSON.stringify({ startedAt: fixedNow + 10000, previousJobId: null }),
    JSON.stringify({ startedAt: fixedNow, previousJobId: "wrong" }),
  ]) {
    f.values.set(key, value);
    assert.equal(f.ui.readExportRequestMarker(owner).kind, "unavailable");
    assert.equal(f.ui.beginExportRequestMarker(owner, null).created, false);
  }
  f.values.clear();
  f.state.writeDenied = true;
  assert.equal(f.ui.beginExportRequestMarker(owner, null).created, false);
  f.state.denied = true;
  assert.equal(f.ui.readExportRequestMarker(owner).kind, "unavailable");
});

test("download destinations bind owner/job and enforce owned-session or configured Storage origin and expiry", () => {
  const { ui } = helperFixture();
  const owned = { downloadUrl: privateUrl(), requiresSession: true, downloadExpiresInSeconds: 0 };
  assert.equal(
    ui.parseExportDownload(
      owned,
      complete(),
      owner,
      "https://kova.test",
      "https://storage.example.test",
      fixedNow,
    ).requiresSession,
    true,
  );
  const signed = {
    downloadUrl: `https://storage.example.test/storage/v1/object/sign/account-exports/${owner}/${id}/${artifact}.json?token=fixture`,
    downloadExpiresInSeconds: 300,
  };
  assert.equal(
    ui.parseExportDownload(
      signed,
      complete(),
      owner,
      "https://kova.test",
      "https://storage.example.test",
      fixedNow,
    ).expiresAt,
    fixedNow + 300000,
  );
  for (const value of [
    { ...owned, downloadUrl: privateUrl().replace(owner, other) },
    { ...owned, downloadUrl: privateUrl().replace(`id=${id}`, `id=${other}`) },
    { ...owned, downloadUrl: `${privateUrl()}&token=credential` },
    { ...owned, downloadUrl: `https://evil.test${privateUrl()}` },
    { ...owned, downloadUrl: "javascript:alert(1)" },
    { ...signed, downloadUrl: signed.downloadUrl.replace("storage.example.test", "evil.test") },
    { ...signed, downloadExpiresInSeconds: 301 },
  ])
    assert.throws(() =>
      ui.parseExportDownload(
        value,
        complete(),
        owner,
        "https://kova.test",
        "https://storage.example.test",
        fixedNow,
      ),
    );
  assert.throws(() =>
    ui.parseExportDownload(
      owned,
      complete(),
      owner,
      "https://kova.test",
      "https://storage.example.test",
      fixedNow + 3600001,
    ),
  );
});

test("the client pins the initiating account and bounds same-origin status/request/cancel traffic", async () => {
  const f = clientFixture(),
    signal = new AbortController().signal;
  await f.client.requestAccountExport(owner, "status", signal);
  f.state.result = { job: job() };
  f.state.status = 202;
  f.state.retryAfter = "5";
  assert.equal((await f.client.requestAccountExport(owner, "request", signal)).retryAfter, 5);
  f.state.result = { job: job("canceled") };
  f.state.status = 200;
  await f.client.requestAccountExport(owner, "cancel", signal, id);
  assert.deepEqual(
    f.calls.map(({ init }) => init.method),
    ["GET", "POST", "DELETE"],
  );
  assert.equal(f.calls[1].init.body, "{}");
  assert.equal(f.calls[2].init.body, JSON.stringify({ id }));
  for (const { url, init } of f.calls) {
    assert.equal(url, "/api/account/export");
    assert.equal(init.headers["X-Kova-Owner"], owner);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.mode, "same-origin");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
  }
  f.state.owner = other;
  await assert.rejects(
    f.client.requestAccountExport(owner, "request", signal),
    (e) => e.definitelyRejected && !e.dispatched,
  );
  assert.equal(f.calls.length, 3);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(f.client.requestAccountExport(owner, "status", aborted.signal));
  assert.equal(f.calls.length, 3);
});

test("network/5xx POST outcomes remain indeterminate; auth/verification/rate rejection remains actionable", async () => {
  const f = clientFixture(),
    signal = new AbortController().signal;
  f.state.fail = true;
  await assert.rejects(
    f.client.requestAccountExport(owner, "request", signal),
    (e) => e.dispatched && !e.definitelyRejected,
  );
  f.state.fail = false;
  for (const status of [401, 403, 429, 503]) {
    f.state.status = status;
    f.state.result = { error: "account_export_request_failed" };
    await assert.rejects(
      f.client.requestAccountExport(owner, "request", signal),
      (e) => e.status === status && e.definitelyRejected === (status !== 503),
    );
  }
  f.state.status = 200;
  f.state.result = {};
  await assert.rejects(
    f.client.requestAccountExport(owner, "request", signal),
    (e) => !e.definitelyRejected,
  );
});

test("DELETE preserves an explicit cleanup failure even when the public job has no recorded file", async () => {
  const f = clientFixture(),
    signal = new AbortController().signal;
  f.state.status = 503;
  f.state.result = {
    job: job("canceled", { cleanupPending: false }),
    error: "account_export_cleanup_finalize_failed",
    cleanupPending: true,
  };
  await assert.rejects(
    f.client.requestAccountExport(owner, "cancel", signal, id),
    (error) => error.status === 503 && error.job.cleanupPending === true,
  );
  f.state.status = 200;
  f.state.result = { job: job("canceled", { cleanupPending: true }), cleanupPending: false };
  assert.equal(
    (await f.client.requestAccountExport(owner, "cancel", signal, id)).job.cleanupPending,
    false,
  );
});

test("authorized download lookup cannot substitute a newer job or an unsafe destination", async () => {
  const f = clientFixture(),
    signal = new AbortController().signal;
  f.state.result = {
    job: complete(),
    downloadUrl: privateUrl(),
    requiresSession: true,
    downloadExpiresInSeconds: 0,
  };
  const result = await f.client.requestAccountExport(owner, "download", signal, id);
  assert.equal(result.download.url, `https://kova.test${privateUrl()}`);
  assert.equal(f.calls[0].url, "/api/account/export?download=1");
  f.state.result.job = complete();
  f.state.result.job.id = other;
  await assert.rejects(f.client.requestAccountExport(owner, "download", signal, id));
});

function panelFixture(handler, helper = helperFixture()) {
  const hooks = createHookHarness(),
    requests = [],
    timers = new Map(),
    listeners = new Map();
  let timerId = 0;
  const client = clientFixture(helper).client;
  const module = loadUiModule(
    "src/components/AccountExportPanel.tsx",
    {
      react: hooks.react,
      "@/components/ui/button": { Button: "Button" },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/lib/account-export-ui": helper.ui,
      "@/lib/account-export-client": {
        ...client,
        requestAccountExport: (...args) => {
          requests.push(args);
          return handler(...args);
        },
      },
      "@/lib/storage-display": { formatStorageBytes: (n) => `${n} B` },
      "@/lib/principal-browser-storage.mjs": {
        ...principal,
        isPrincipalBrowserStorageClearedEvent: (event, id) => event.owner === id,
      },
    },
    {
      AbortController,
      AbortSignal,
      Date: helper.FakeDate,
      setTimeout: (fn, delay) => {
        const id = ++timerId;
        timers.set(id, { fn, at: helper.state.now + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      window: {
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name),
      },
    },
  );
  const props = { ownerId: owner, enabled: true };
  const wrapper = () => module.AccountExportPanel(props);
  const root = wrapper();
  const render = () => hooks.render(root.type, props);
  return {
    helper,
    client,
    requests,
    timers,
    listeners,
    hooks,
    props,
    wrapper,
    render,
    button(label) {
      return elements(render(), (node) => node.type === "Button" && text(node).trim() === label)[0];
    },
    async nextPoll() {
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(id);
      helper.state.now = timer.at;
      timer.fn();
      await settle();
    },
  };
}

test("UI uses real queued/processing/completed states and polls only while open without fake progress", async () => {
  let current = null;
  const f = panelFixture(async (_owner, operation) => {
    if (operation === "request") current = job();
    return { job: current, retryAfter: 5 };
  });
  f.render();
  await settle();
  assert.match(text(f.render()), /No previous account export/);
  const request = f.button("Request account export");
  request.props.onClick();
  request.props.onClick();
  await settle();
  assert.equal(f.requests.filter(([, op]) => op === "request").length, 1);
  assert.match(text(f.render()), /Requested/);
  current = job("processing");
  await f.nextPoll();
  assert.match(text(f.render()), /Preparing/);
  assert.equal(f.button("Cancel queued export"), undefined);
  current = complete();
  await f.nextPoll();
  assert.match(text(f.render()), /Ready/);
  assert.match(text(f.render()), /4096 B/);
  assert.doesNotMatch(text(f.render()), /\d+%/);
  assert.ok(f.button("Prepare account download"));
  f.props.enabled = false;
  assert.equal(f.render(), null);
  assert.equal(f.timers.size, 0);
  assert.equal(f.requests.at(-1)[2].aborted, true);
});

test("lost POST never replays, even after a null status or remount, and a new observed job reconciles it", async () => {
  let latest = null;
  const helper = helperFixture();
  let f;
  const handler = async (_owner, operation) => {
    if (operation === "request") throw new f.client.AccountExportRequestError("lost", true);
    return { job: latest, retryAfter: 5 };
  };
  f = panelFixture(handler, helper);
  f.render();
  await settle();
  f.button("Request account export").props.onClick();
  await settle();
  assert.match(text(f.render()), /previous request has not been confirmed/);
  await f.nextPoll();
  f.button("Request account export").props.onClick();
  await settle();
  assert.equal(f.requests.filter(([, op]) => op === "request").length, 1);
  f.hooks.unmount();
  const reopened = panelFixture(async () => ({ job: latest }), helper);
  reopened.render();
  await settle();
  assert.equal(reopened.button("Request account export").props.disabled, true);
  latest = job("processing");
  await reopened.nextPoll();
  assert.equal(helper.ui.readExportRequestMarker(owner).kind, "none");
  assert.doesNotMatch(text(reopened.render()), /previous request has not been confirmed/);
  assert.equal(
    reopened.requests.every(([, op]) => op === "status"),
    true,
  );
});

test("an uncertain request leaves an older completed job read-only until reconciled", async () => {
  const previous = complete();
  previous.requestedAt = new Date(fixedNow - 86400000).toISOString();
  let f;
  f = panelFixture(async (_owner, operation) => {
    if (operation === "request") throw new f.client.AccountExportRequestError("lost", true);
    return { job: previous };
  });
  f.render();
  await settle();
  const oldDownloadAction = f.button("Prepare account download").props.onClick;
  f.button("Request new account export").props.onClick();
  await settle();
  assert.equal(f.button("Remove export file").props.disabled, true);
  assert.equal(f.button("Prepare account download").props.disabled, true);
  assert.equal(f.button("Refresh export status").props.disabled, false);
  oldDownloadAction();
  f.button("Remove export file").props.onClick();
  elements(f.render(), (node) => node.type === "ConfirmActionDialog")[0].props.onConfirm();
  await settle();
  assert.deepEqual(
    f.requests.map(([, operation]) => operation),
    ["status", "request"],
  );
  await f.nextPoll();
  assert.equal(f.helper.ui.readExportRequestMarker(owner).kind, "pending");
});

test("session-storage denial and a competing saved request fail closed before POST", async () => {
  const f = panelFixture(async () => ({ job: null }));
  f.render();
  await settle();
  f.helper.state.writeDenied = true;
  f.button("Request account export").props.onClick();
  await settle();
  assert.equal(
    f.requests.some(([, op]) => op === "request"),
    false,
  );
  const racing = panelFixture(async () => ({ job: null }));
  racing.render();
  await settle();
  racing.helper.ui.beginExportRequestMarker(owner, null);
  racing.button("Request account export").props.onClick();
  await settle();
  assert.equal(
    racing.requests.some(([, op]) => op === "request"),
    false,
  );
});

test("late responses, account remounts, hidden sections and principal cleanup cannot expose old data", async () => {
  const late = deferred();
  const f = panelFixture(() => late.promise);
  f.render();
  const oldSignal = f.requests[0][2];
  f.props.enabled = false;
  f.render();
  assert.equal(oldSignal.aborted, true);
  late.resolve({ job: complete() });
  await settle();
  assert.equal(f.render(), null);
  f.props.ownerId = other;
  assert.equal(f.wrapper().key, other);
  const g = panelFixture(async () => ({ job: complete() }));
  g.render();
  await settle();
  g.listeners.get(principal.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT)({ owner });
  assert.match(text(g.render()), /cleared from this browser/);
  assert.doesNotMatch(text(g.render()), /Ready|4096/);
  assert.equal(g.timers.size, 0);
});

test("cancellation targets the confirmed job, reports processing conflicts, and keeps cleanup pending visible", async () => {
  let f,
    cleanup = false;
  f = panelFixture(async (_owner, operation, _signal, target) => {
    if (operation === "cancel") {
      assert.equal(target, id);
      throw new f.client.AccountExportRequestError(
        cleanup ? "account_export_delete_failed" : "account_export_processing",
        true,
        cleanup ? 503 : 409,
        cleanup ? job("canceled", { cleanupPending: true }) : job("processing"),
        5,
      );
    }
    return { job: job() };
  });
  f.render();
  await settle();
  f.button("Cancel queued export").props.onClick();
  elements(f.render(), (node) => node.type === "ConfirmActionDialog")[0].props.onConfirm();
  await settle();
  assert.match(text(f.render()), /Preparing/);
  assert.match(text(f.render()), /cannot be canceled yet/);
  cleanup = true;
  await f.nextPoll();
  f.button("Cancel queued export").props.onClick();
  elements(f.render(), (node) => node.type === "ConfirmActionDialog")[0].props.onConfirm();
  await settle();
  assert.match(text(f.render()), /Canceled/);
  assert.match(text(f.render()), /still pending/);
  assert.ok(f.button("Retry export removal"));
});

test("download preparation exposes only a checked expiring link and never claims file delivery", async () => {
  const f = panelFixture(async (_owner, operation) => ({
    job: complete(),
    ...(operation === "download"
      ? {
          download: {
            url: `https://kova.test${privateUrl()}`,
            expiresAt: fixedNow + 300000,
            requiresSession: true,
          },
        }
      : {}),
  }));
  f.render();
  await settle();
  f.button("Prepare account download").props.onClick();
  await settle();
  let tree = f.render();
  const link = elements(tree, (node) => node.type === "a")[0];
  assert.equal(link.props.rel, "noopener noreferrer");
  assert.match(text(tree), /Download link ready/);
  assert.doesNotMatch(text(tree), /downloaded successfully|Export downloaded/i);
  f.helper.state.now = fixedNow + 300001;
  let prevented = false;
  link.props.onClick({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  f.props.enabled = false;
  f.render();
  assert.equal(f.timers.size, 0);
});

test("Settings keeps cloud export distinct from the existing device JSON export", () => {
  const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
  assert.match(
    source,
    /<AccountExportPanel[\s\S]*?ownerId=\{isLoaded && isSignedIn \? userKey : null\}[\s\S]*?enabled=\{open && tab === "data"\}/,
  );
  assert.match(source, /title="Export this device's data"/);
  assert.match(source, /Cloud account records are not included/);
  assert.match(source, /format: "kovagpt-device-export"/);
});
