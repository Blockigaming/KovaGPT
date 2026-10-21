import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { formatDisplayDateTime, timeFormatValue } from "../../src/lib/time-format.ts";
import * as settingsStorage from "../../src/lib/settings-storage.ts";
import * as principalStorage from "../../src/lib/principal-browser-storage.mjs";
import { createHookHarness, loadUiModule } from "../helpers/ui-state-harness.mjs";

const instant = "2026-10-20T00:00:00.000Z";
const formats = ["system", "12-hour", "24-hour"];

test("missing and malformed preferences preserve device defaults", () => {
  for (const value of [undefined, null, "system", "invalid", 12, true, {}, []])
    assert.equal(timeFormatValue(value), "system");
  for (const value of ["12-hour", "24-hour"]) assert.equal(timeFormatValue(value), value);
});

test("same instant keeps locale, date, timezone and seconds in all three display modes", () => {
  const value = new Date(instant);
  for (const locale of ["en-US", "en-GB", "de-DE"])
    for (const timeZone of ["UTC", "America/Los_Angeles", "Asia/Kathmandu"])
      for (const preference of formats) {
        const options = Object.freeze({ timeZone });
        const hourCycle = preference === "12-hour" ? "h12" : "h23";
        const expected = value.toLocaleString(locale, {
          timeZone,
          ...(preference === "system" ? {} : { hourCycle }),
        });
        assert.equal(formatDisplayDateTime(value, preference, options, locale), expected);
        assert.equal(value.toISOString(), instant, "formatting must never mutate the timestamp");
        assert.deepEqual(options, { timeZone });
      }
  assert.equal(
    formatDisplayDateTime(instant, "12-hour", { timeZone: "UTC" }, "en-US"),
    "10/20/2026, 12:00:00 AM",
  );
  assert.equal(
    formatDisplayDateTime(instant, "24-hour", { timeZone: "UTC" }, "en-US"),
    "10/20/2026, 00:00:00",
  );
});

test("UTC reset contract and device-local previous calendar day stay intact", () => {
  const options = { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" };
  assert.equal(
    formatDisplayDateTime(instant, "12-hour", options, "en-US"),
    "Oct 19, 2026, 5:00 PM",
  );
  assert.equal(formatDisplayDateTime(instant, "24-hour", options, "en-US"), "Oct 19, 2026, 17:00");
  assert.equal(new Date(instant).getUTCHours(), 0);
  assert.equal(new Date(instant).getUTCDate(), 20);
});

test("schedule IANA zone keeps DST offsets and repeated wall times", () => {
  for (const [iso, offset] of [
    ["2026-11-01T05:30:00Z", "EDT"],
    ["2026-11-01T06:30:00Z", "EST"],
  ]) {
    const options = {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    };
    assert.equal(formatDisplayDateTime(iso, "12-hour", options, "en-US"), `1:30 AM ${offset}`);
    assert.equal(formatDisplayDateTime(iso, "24-hour", options, "en-US"), `01:30 ${offset}`);
  }
  assert.equal(formatDisplayDateTime("bad timestamp", "24-hour"), "Time unavailable");
});

function fixture() {
  const values = new Map();
  const reads = [],
    writes = [];
  const storage = {
    fail: false,
    getItem(key) {
      reads.push(key);
      if (this.fail) throw new Error("Storage unavailable");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const window = new EventTarget();
  window.localStorage = storage;
  const localSettings = loadUiModule(
    "src/lib/settings-storage.ts",
    {},
    { window, localStorage: storage },
  );
  const harness = createHookHarness();
  let notifications = 0,
    serverValue;
  harness.react.useSyncExternalStore = (subscribe, getSnapshot, getServerSnapshot) => {
    harness.react.useEffect(
      () =>
        subscribe(() => {
          notifications++;
        }),
      [subscribe],
    );
    serverValue = getServerSnapshot();
    return getSnapshot();
  };
  const { useTimeFormatPreference } = loadUiModule(
    "src/hooks/use-time-format-preference.ts",
    {
      react: harness.react,
      "@/lib/time-format": { timeFormatValue },
      "@/lib/settings-storage": localSettings,
      "@/lib/principal-browser-storage.mjs": {
        ...principalStorage,
        safeBrowserStorage: (area) => principalStorage.safeBrowserStorage(area, window),
      },
    },
    { window },
  );
  const emit = (type, fields = {}) => {
    const event = new Event(type);
    Object.assign(event, fields);
    window.dispatchEvent(event);
  };
  return {
    values,
    reads,
    writes,
    storage,
    window,
    emit,
    render: (owner, ready = true) => harness.render(() => useTimeFormatPreference(owner, ready)),
    seed: (owner, timeFormat) =>
      values.set(
        settingsStorage.settingsKey(owner),
        JSON.stringify({ timeFormat, extraFacts: `${owner} private fact` }),
      ),
    get notifications() {
      return notifications;
    },
    get serverValue() {
      return serverValue;
    },
    unmount: () => harness.unmount(),
  };
}

test("unresolved auth and server hydration use system without touching guest or account storage", () => {
  const f = fixture();
  f.seed(null, "12-hour");
  f.seed("account-a", "24-hour");
  assert.equal(f.render(null, false), "system");
  assert.equal(f.render("account-a", false), "system");
  assert.equal(f.serverValue, "system");
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.writes, []);
  f.unmount();
});

test("account switching and sign-out immediately read only that principal with no copied preference or writes", () => {
  const f = fixture();
  f.seed("account-a", "24-hour");
  f.seed("account-b", "12-hour");
  f.seed(null, "system");
  f.values.set("nova-gpt-settings-v1", JSON.stringify({ timeFormat: "24-hour" }));
  for (const [owner, expected] of [
    ["account-a", "24-hour"],
    ["account-b", "12-hour"],
    [null, "system"],
    ["account-c", "system"],
    ["account-a", "24-hour"],
  ]) {
    f.reads.length = 0;
    assert.equal(f.render(owner), expected);
    assert.deepEqual(f.reads, [settingsStorage.settingsKey(owner)]);
  }
  assert.deepEqual(f.writes, []);
  assert.ok(f.values.has("nova-gpt-settings-v1"), "readers never migrate ownerless data");
  f.unmount();
});

test("same-tab saves, other-tab changes and principal resets notify only matching mounted readers", () => {
  const f = fixture();
  f.seed("account-a", "12-hour");
  f.render("account-a");
  const saved = (ownerId) => f.emit("kova:settings-saved", { detail: { ownerId } });
  saved("account-b");
  saved(null);
  assert.equal(f.notifications, 0);
  f.seed("account-a", "24-hour");
  saved("account-a");
  assert.equal(f.notifications, 1);
  assert.equal(f.render("account-a"), "24-hour");
  f.emit("storage", { key: settingsStorage.settingsKey("account-b"), storageArea: f.storage });
  f.emit("storage", { key: settingsStorage.settingsKey("account-a"), storageArea: {} });
  assert.equal(f.notifications, 1);
  f.seed("account-a", "12-hour");
  f.emit("storage", { key: settingsStorage.settingsKey("account-a"), storageArea: f.storage });
  assert.equal(f.notifications, 2);
  assert.equal(f.render("account-a"), "12-hour");
  f.emit(principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, {
    detail: { principal: principalStorage.browserStoragePrincipal("account-b") },
  });
  assert.equal(f.notifications, 2);
  f.values.delete(settingsStorage.settingsKey("account-a"));
  f.emit(principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, {
    detail: { principal: principalStorage.browserStoragePrincipal("account-a") },
  });
  assert.equal(f.notifications, 3);
  assert.equal(f.render("account-a"), "system");
  assert.deepEqual(f.writes, []);
  f.render("account-b");
  saved("account-a");
  assert.equal(f.notifications, 3, "account switch removes obsolete listeners");
  saved("account-b");
  assert.equal(f.notifications, 4);
  f.emit("storage", { key: null, storageArea: f.storage });
  assert.equal(f.notifications, 5);
  f.unmount();
  saved("account-b");
  assert.equal(f.notifications, 5, "unmounted readers unsubscribe");
});

test("malformed, missing and unavailable storage safely fall back without overwriting anything", () => {
  const f = fixture();
  const key = settingsStorage.settingsKey("account-a");
  for (const raw of ["not JSON", "null", "[]", '{"timeFormat":"bad"}', "{}"]) {
    f.values.set(key, raw);
    assert.equal(f.render("account-a"), "system");
    assert.equal(f.values.get(key), raw);
  }
  f.seed("account-a", "24-hour");
  f.storage.fail = true;
  assert.equal(f.render("account-a"), "system");
  f.storage.fail = false;
  assert.equal(f.render("account-a"), "24-hour");
  assert.deepEqual(f.writes, []);
  f.unmount();
});

function formatterCalls(path) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "formatDisplayDateTime")
      calls.push(node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { source, calls };
}

// Execute the actual UI formatter calls, including their options, against one known instant.
// This covers consumer wiring without claiming DOM/browser evidence.
for (const [path, scope, expectedCalls] of [
  ["src/routes/scheduled-tasks.tsx", { t: { next_run_at: instant, run_at: instant } }, 2],
  [
    "src/components/ScheduledTaskLastRun.tsx",
    { preview: { at: instant, retryAt: instant }, lastRunAt: instant },
    3,
  ],
  [
    "src/components/ScheduledTaskEditor.tsx",
    {
      task: { next_run_at: instant, timezone: "America/New_York" },
      run: { scheduled_for: instant, started_at: instant },
    },
    3,
  ],
  ["src/components/AutomationBuilder.tsx", { runAt: instant }, 1],
  [
    "src/routes/library.tsx",
    {
      visiblePreviewItem: { created_at: instant, updated_at: instant },
      metadata: { modifiedAt: instant },
    },
    3,
  ],
  ["src/routes/audit-log.tsx", { row: { created_at: instant } }, 1],
  ["src/routes/notifications.tsx", { item: { createdAt: instant } }, 1],
  [
    "src/components/SettingsDialog.tsx",
    {
      usage: { resetsAt: instant },
      item: { created_at: instant },
      subSummary: { currentPeriodEnd: instant },
    },
    6,
  ],
]) {
  test(`${path} uses the shared preference for every scoped timestamp consumer`, () => {
    const { source, calls } = formatterCalls(path);
    assert.equal(calls.length, expectedCalls);
    for (const expression of calls)
      for (const timeFormat of formats) {
        const args = { ...scope, timeFormat, settings: { timeFormat } };
        const invoked = [];
        const output = new Function(
          ...Object.keys(args),
          "formatDisplayDateTime",
          ts.transpileModule(`return (${expression});`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
          }).outputText,
        )(...Object.values(args), (...parameters) => {
          invoked.push(parameters);
          return formatDisplayDateTime(...parameters);
        });
        assert.equal(invoked[0][0], instant);
        assert.equal(invoked[0][1], timeFormat);
        assert.equal(typeof output, "string");
        if (expression.includes("task.next_run_at"))
          assert.equal(
            invoked[0][2].timeZone,
            "America/New_York",
            "confirmed schedule keeps its own IANA zone",
          );
      }
    if (path.endsWith("SettingsDialog.tsx")) {
      assert.match(source, /Accounting resets at midnight UTC/);
      assert.doesNotMatch(source, /currentPeriodEnd\)\.toLocaleDateString\(\)/);
      assert.match(source, /timeFormat=\{settings.timeFormat\}/);
    }
  });
}
