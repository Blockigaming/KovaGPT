import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as grace from "../../src/lib/account-deletion-grace.mjs";
import {
  ACCOUNT_DELETION_PREVIEW_STATES,
  ACCOUNT_DELETION_REVIEW_LABEL,
  SAMPLE_EFFECTIVE_AT,
  SAMPLE_REQUESTED_AT,
  accountDeletionPreviewReducer as reduce,
  createAccountDeletionPreview as create,
} from "../../review-kit/account-deletion-preview-state.mjs";

const read = (path) => readFileSync(path, "utf8");
const view = read("src/components/AccountDeletionGraceView.tsx");
const settings = read("src/components/SettingsDialog.tsx");
const event = (state, type, rest = {}) => ({
  ownerId: state.ownerId,
  generation: state.generation,
  type,
  ...rest,
});
const opened = (fixture = "confirm") => {
  const state = create("owner-a", fixture);
  return reduce(state, event(state, "open"));
};

test("review schedule, repeat-click, recovery, and cancellation lifecycle is local and explicit", () => {
  let state = opened();
  const canceled = reduce(state, event(state, "close"));
  assert.equal(canceled.open, false);
  assert.equal(canceled.status, "confirm");
  assert.equal(canceled.schedule, undefined);
  assert.equal(reduce(canceled, event(state, "schedule", { result: "success" })), canceled);
  state = reduce(state, event(state, "schedule", { result: "success" }));
  assert.equal(state.status, "scheduled");
  assert.equal(
    Date.parse(state.schedule.effectiveAt) - Date.parse(state.schedule.requestedAt),
    30 * 24 * 60 * 60 * 1000,
  );
  assert.equal(reduce(state, event(state, "schedule", { result: "success" })), state);
  const closed = reduce(state, event(state, "close"));
  assert.deepEqual(closed.schedule, state.schedule);
  assert.equal(closed.status, "scheduled");
  state = reduce(state, event(state, "recover", { result: "success" }));
  assert.equal(state.status, "recovered");
  assert.equal(state.schedule, undefined);
  assert.equal(reduce(state, event(state, "recover", { result: "success" })), state);
});

test("schedule rejection never invents dates; failed recovery keeps the request recoverable", () => {
  let state = opened();
  state = reduce(state, event(state, "schedule", { result: "failure" }));
  assert.equal(state.status, "schedule-failed");
  assert.equal(state.schedule, undefined);
  state = reduce(state, event(state, "schedule", { result: "success" }));
  const schedule = state.schedule;
  state = reduce(state, event(state, "recover", { result: "failure" }));
  assert.equal(state.status, "recovery-failed");
  assert.equal(state.schedule, schedule);
  assert.equal(grace.canRecoverAccountDeletion(state.status), true);
  state = reduce(state, event(state, "recover", { result: "success" }));
  assert.equal(state.status, "recovered");
});

test("exact expiry boundary closes recovery but never claims deletion has started or completed", () => {
  const deadline = Date.parse(SAMPLE_EFFECTIVE_AT);
  assert.equal(grace.accountDeletionDeadlinePassed(SAMPLE_EFFECTIVE_AT, deadline - 1), false);
  assert.equal(grace.accountDeletionDeadlinePassed(SAMPLE_EFFECTIVE_AT, deadline), true);
  assert.equal(grace.accountDeletionDeadlinePassed(SAMPLE_EFFECTIVE_AT, deadline + 1), true);
  assert.equal(grace.accountDeletionDeadlinePassed("invalid", deadline), false);
  assert.equal(grace.accountDeletionDeadlinePassed(SAMPLE_EFFECTIVE_AT, NaN), false);
  assert.equal(deadline - Date.parse(SAMPLE_REQUESTED_AT), grace.ACCOUNT_DELETION_GRACE_MS);
  assert.match(
    grace.formatAccountDeletionDate(SAMPLE_REQUESTED_AT, "America/Los_Angeles"),
    /5:00 AM PDT/,
  );
  assert.match(
    grace.formatAccountDeletionDate(SAMPLE_EFFECTIVE_AT, "America/Los_Angeles"),
    /4:00 AM PST/,
  );
  for (const observation of [deadline - 1, deadline, deadline + 1]) {
    const expired = grace.accountDeletionDeadlinePassed(SAMPLE_EFFECTIVE_AT, observation);
    assert.equal(grace.canRecoverAccountDeletion("scheduled", expired), observation < deadline);
    assert.equal(
      grace.canRecoverAccountDeletion("recovery-failed", expired),
      observation < deadline,
    );
  }
  for (const fixture of ["at-deadline", "overdue"]) {
    const overdue = opened(fixture);
    assert.equal(overdue.schedule.overdue, true);
    assert.equal(overdue.status, "expired");
    assert.equal(reduce(overdue, event(overdue, "tick", { now: deadline + 1e12 })), overdue);
    assert.equal(reduce(overdue, event(overdue, "recover", { result: "success" })), overdue);
    assert.equal(reduce(overdue, event(overdue, "schedule", { result: "success" })), overdue);
  }
  for (const fixture of ["deleting", "deleted", "unknown", "unavailable"]) {
    const state = opened(fixture);
    assert.equal(grace.canRecoverAccountDeletion(state.status), false);
    assert.equal(reduce(state, event(state, "recover", { result: "success" })), state);
    assert.equal(reduce(state, event(state, "schedule", { result: "success" })), state);
  }
});

test("account change and closed/reopened lifetime reject stale confirmation and recovery", () => {
  for (const fixture of ["confirm", "scheduled"]) {
    const state = opened(fixture);
    const stale = event(state, fixture === "confirm" ? "schedule" : "recover", {
      result: "success",
    });
    const nextOwner = reduce(state, { type: "switch-owner", nextOwnerId: "owner-b" });
    assert.equal(nextOwner.open, false);
    assert.equal(nextOwner.status, "confirm");
    assert.equal(nextOwner.schedule, undefined);
    assert.equal(reduce(nextOwner, stale), nextOwner);
    const closed = reduce(state, event(state, "close"));
    const reopened = reduce(closed, event(closed, "open"));
    assert.equal(reduce(reopened, stale), reopened);
    const reset = reduce(state, event(state, "fixture", { fixture: "scheduled" }));
    assert.equal(reduce(reset, stale), reset);
  }
});

test("production entry binds scheduling and recovery to the confirmed account without preview state", () => {
  const parsed = ts.createSourceFile("SettingsDialog.tsx", settings, ts.ScriptTarget.Latest, true);
  const elements = [];
  const collect = (node) => {
    if (ts.isJsxElement(node)) elements.push(node);
    ts.forEachChild(node, collect);
  };
  collect(parsed);
  const dialogs = elements.filter(
    (node) =>
      node.openingElement.tagName.getText(parsed) === "AlertDialog" &&
      node.getText(parsed).includes("Schedule account deletion?"),
  );
  assert.equal(dialogs.length, 1);
  const dialog = dialogs[0];
  const expression = (node, name) => {
    const attribute = node.openingElement.attributes.properties.find(
      (item) => ts.isJsxAttribute(item) && item.name.getText(parsed) === name,
    );
    assert.ok(attribute && ts.isJsxExpression(attribute.initializer));
    return attribute.initializer.expression.getText(parsed);
  };
  const evaluate = (code, values) =>
    new Function(...Object.keys(values), `return (${code});`)(...Object.values(values));
  const account = {
    deleteAccountOpen: true,
    open: true,
    tab: "data",
    isLoaded: true,
    userKey: "owner-a",
    deleteAccountReturnRef: { current: { ownerId: "owner-a" } },
  };
  const visible = (overrides = {}) =>
    Boolean(evaluate(expression(dialog, "open"), { ...account, ...overrides }));
  assert.equal(visible(), true);
  for (const overrides of [
    { deleteAccountOpen: false },
    { open: false },
    { tab: "storage" },
    { isLoaded: false },
    { userKey: "owner-b" },
    { deleteAccountReturnRef: { current: null } },
  ])
    assert.equal(visible(overrides), false);

  const actions = elements.filter(
    (node) =>
      node.openingElement.tagName.getText(parsed) === "Button" &&
      node.getText(parsed).includes("? handleRecoverAccount"),
  );
  assert.equal(actions.length, 1);
  const action = actions[0];
  const handlers = {
    handleDeleteAccount: () => {},
    handleRecoverAccount: () => {},
    handleCheckDeletion: () => {},
  };
  for (const [recoverable, pending, expected] of [
    [false, false, handlers.handleDeleteAccount],
    [true, true, handlers.handleRecoverAccount],
    [false, true, handlers.handleCheckDeletion],
  ])
    assert.equal(
      evaluate(expression(action, "onClick"), {
        ...handlers,
        deletionRecoverable: recoverable,
        deletionPending: pending,
      }),
      expected,
    );
  for (const [pending, confirmation, busy, expected] of [
    [false, "", false, true],
    [false, "delete", false, true],
    [false, "DELETE", false, false],
    [false, "DELETE", true, true],
    [true, "", false, false],
    [true, "", true, true],
  ])
    assert.equal(
      evaluate(expression(action, "disabled"), {
        deletionPending: pending,
        deleteConfirmation: confirmation,
        deleteAccountBusy: busy,
      }),
      expected,
    );
  const element = dialog.getText(parsed);
  assert.match(element, /recoverable for 30 days before final deletion/);
  assert.doesNotMatch(element, /Delete your account permanently|Continue account deletion/);
  assert.match(settings, /setDeleteAccountOpen\(false\);\s*\}, \[open, tab, userKey, isLoaded\]\)/);
  assert.doesNotMatch(
    settings,
    /<AccountDeletionGraceView|account-deletion-preview|SAMPLE_REQUESTED_AT|SAMPLE_EFFECTIVE_AT/,
  );
});

test("shared view and private controller have no data mutation, provider, or real identity escape hatch", () => {
  for (const source of [
    view,
    read("review-kit/account-deletion-preview.tsx"),
    read("review-kit/account-deletion-preview-state.mjs"),
  ]) {
    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|XMLHttpRequest|WebSocket|supabase|authFetch|requestAccountDeletion|localStorage|sessionStorage|signOut|resetPrincipalDeviceData|user_metadata|URLSearchParams|location\.search|Date\.now|setInterval|setTimeout/,
    );
  }
  assert.doesNotMatch(view, /sample-owner|SAMPLE_|fixture|useEffect/);
  assert.match(view, /onOpenAutoFocus[\s\S]*?closeRef\.current\?\.focus\(\)/);
  assert.match(view, /<DialogDescription>/);
  assert.match(view, /role="alert"/);
  assert.match(view, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.ok(
    view.indexOf("Closing this dialog does not cancel it") < view.indexOf("<DialogFooter>"),
  );
  assert.match(read("src/components/account-deletion-grace.css"), /min-height: 44px/);
  assert.match(
    read("src/components/account-deletion-grace.css"),
    /border-radius: var\(--kova-radius-button\)/,
  );
  assert.match(
    read("src/components/account-deletion-grace.css"),
    /border-radius: var\(--kova-radius-panel\)/,
  );
});

function loadView() {
  const require = createRequire(import.meta.url);
  const tags = {
    Dialog: "div",
    DialogContent: "section",
    DialogDescription: "p",
    DialogFooter: "footer",
    DialogHeader: "header",
    DialogTitle: "h1",
  };
  const fakeRequire = (name) => {
    if (name.endsWith(".css")) return {};
    if (name === "@/lib/account-deletion-grace.mjs") return grace;
    if (name === "@/components/ui/dialog")
      return Object.fromEntries(
        Object.entries(tags).map(([key, tag]) => [
          key,
          ({ children, className, ...props }) =>
            React.createElement(
              tag,
              {
                className,
                ...(key === "DialogContent"
                  ? { "data-state": props["data-account-deletion-state"] }
                  : {}),
              },
              children,
            ),
        ]),
      );
    if (name === "@/components/ui/button")
      return {
        Button: ({ children, variant, ...props }) => React.createElement("button", props, children),
      };
    return require(name);
  };
  const js = ts.transpileModule(view, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)(fakeRequire, exports);
  return exports.AccountDeletionGraceView;
}
const View = loadView();
const markup = (fixture, props = {}) => {
  const state = opened(fixture);
  return renderToStaticMarkup(
    React.createElement(View, {
      ...state,
      reviewLabel: ACCOUNT_DELETION_REVIEW_LABEL,
      onOpenChange() {},
      onRecover() {},
      onSchedule() {},
      ...props,
    }),
  );
};
test("all review states render explicit outcomes; unavailable never renders dates or a recovery action", () => {
  for (const fixture of ACCOUNT_DELETION_PREVIEW_STATES)
    assert.match(markup(fixture), /Synthetic account review/);
  const unavailable = markup("unavailable", { reviewLabel: undefined });
  assert.match(unavailable, /not available here yet/);
  assert.match(unavailable, /cannot verify your current deletion status/);
  assert.doesNotMatch(
    unavailable,
    /<time|Recover account|Schedule deletion<\/button>|Account recovered|Deletion canceled successfully/,
  );
  assert.match(unavailable, /disabled=""[^>]*>Scheduling unavailable/);
  assert.match(markup("confirm"), />Cancel<\/button>/);
  assert.match(markup("scheduled"), /<time dateTime="2026-11-18T12:00:00.000Z"/);
  assert.match(markup("scheduled"), /America\/Los_Angeles/);
  for (const fixture of ["at-deadline", "overdue"]) {
    assert.match(markup(fixture), /Recovery window expired/);
    assert.match(markup(fixture), /Actual deletion status is unknown/);
    assert.doesNotMatch(
      markup(fixture),
      />Recover account<\/button>|>Schedule deletion<\/button>|>Account deleted<\/h1>/,
    );
  }
  for (const fixture of ["deleting", "deleted", "unknown"])
    assert.doesNotMatch(markup(fixture), />Recover account<\/button>|>Schedule deletion<\/button>/);
  assert.match(markup("deleting"), /not a recoverable grace-period state/);
  assert.match(markup("recovered"), /account is active again/);
});

test("private bundle metadata registers HTML, JS, CSS, navigation and synthetic-only policy", () => {
  const builder = read("review-kit/build-plugin-preview.mjs");
  const adapter = read("review-kit/private-http-review.mjs");
  assert.match(
    builder,
    /entryPoints: \[join\(root, "review-kit\/account-deletion-preview\.tsx"\)\]/,
  );
  assert.match(builder, /outfile: join\(out, "account-deletion-preview\.js"\)/);
  assert.match(builder, /join\(out, "account-deletion-preview\.html"\)/);
  assert.match(builder, /replaceAll\("voice-preview", "account-deletion-preview"\)/);
  for (const extension of ["html", "js", "css"])
    assert.ok(adapter.includes(`review/account-deletion-preview.${extension}`));
  assert.match(adapter, /href="\/__private-review\/account-deletion-preview"/);
  assert.match(adapter, /"X-Kova-Private-Review": "synthetic-only"/);
  assert.match(adapter, /"X-Robots-Tag": "noindex, nofollow, noarchive"/);
});
