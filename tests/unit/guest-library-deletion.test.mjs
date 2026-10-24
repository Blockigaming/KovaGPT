import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("src/lib/guest-library.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const key = "kova-guest-library";
const item = (id) => ({
  id,
  title: `Saved ${id}`,
  item_type: "upload",
  source: "upload",
  content_text: null,
  file_url: `data:text/plain,${id}`,
  file_name: `${id}.txt`,
  file_type: "text/plain",
  file_size: 10,
  created_at: "2026-01-01T00:00:00.000Z",
});

function fixture(raw, { readError, writeError } = {}) {
  const values = new Map([["unrelated-preference", "keep"]]);
  if (raw !== null) values.set(key, raw);
  const writes = [];
  const storage = {
    getItem(name) {
      if (readError) throw readError;
      return values.get(name) ?? null;
    },
    setItem(name, value) {
      writes.push([name, value]);
      const error = typeof writeError === "function" ? writeError(writes.length) : writeError;
      if (error) throw error;
      values.set(name, value);
    },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, localStorage: storage });
  return { ...exports, values, writes };
}

test("guest deletion persists only the requested removal and preserves other stored data", () => {
  const items = [item("guest-first"), item("guest-delete"), item("guest-last")];
  const view = fixture(JSON.stringify(items));

  assert.equal(view.deleteGuestItem("guest-delete"), undefined);

  assert.deepEqual(JSON.parse(view.values.get(key)), [items[0], items[2]]);
  assert.equal(view.values.get("unrelated-preference"), "keep");
  assert.deepEqual(view.writes, [[key, JSON.stringify([items[0], items[2]])]]);
});

test("guest deletion never applies the save-time item cap to surviving records", () => {
  const items = Array.from({ length: 205 }, (_, index) => item(`guest-${index}`));
  const view = fixture(JSON.stringify(items));

  view.deleteGuestItem("guest-100");

  assert.deepEqual(
    JSON.parse(view.values.get(key)),
    items.filter((saved) => saved.id !== "guest-100"),
  );
  assert.equal(view.writes.length, 1);
});

for (const name of ["QuotaExceededError", "SecurityError"]) {
  test(`${name} is reported without retrying or discarding unrelated guest records`, () => {
    const items = Array.from({ length: 80 }, (_, index) => item(`guest-${index}`));
    const raw = JSON.stringify(items);
    const error = Object.assign(new Error("Synthetic storage write failure"), { name });
    // A second write would succeed, exposing any destructive fallback retry.
    const view = fixture(raw, { writeError: (attempt) => (attempt === 1 ? error : null) });

    assert.throws(
      () => view.deleteGuestItem("guest-10"),
      (caught) => caught === error,
    );

    assert.equal(view.values.get(key), raw);
    assert.equal(view.values.get("unrelated-preference"), "keep");
    assert.equal(view.writes.length, 1);
    assert.deepEqual(
      JSON.parse(view.writes[0][1]),
      items.filter((saved) => saved.id !== "guest-10"),
    );
  });
}

test("unreadable guest storage throws before attempting any write", () => {
  const raw = JSON.stringify([item("guest-keep"), item("guest-delete")]);
  const error = new Error("Synthetic storage read failure");
  const view = fixture(raw, { readError: error });

  assert.throws(
    () => view.deleteGuestItem("guest-delete"),
    (caught) => caught === error,
  );

  assert.equal(view.values.get(key), raw);
  assert.deepEqual(view.writes, []);
});

test("unavailable guest storage cannot report successful deletion", () => {
  const exports = {};
  vm.runInNewContext(source, { exports });

  assert.throws(() => exports.deleteGuestItem("guest-delete"), /storage is unavailable/);
});

test("denied access to the storage object propagates without falling back to an empty library", () => {
  const exports = {};
  const error = new Error("Synthetic storage access denial");
  vm.runInNewContext(
    `Object.defineProperty(globalThis, "localStorage", {
      get() { throw storageError; },
    });\n${source}`,
    { exports, storageError: error },
  );

  assert.throws(
    () => exports.deleteGuestItem("guest-delete"),
    (caught) => caught === error,
  );
});

test("malformed stored data is retained unchanged instead of being treated as an empty library", () => {
  for (const raw of [
    "{not-json",
    "",
    "null",
    "{}",
    "42",
    '"saved text"',
    "[null]",
    '[{"title":"missing id"}]',
    '[{"id":123}]',
    JSON.stringify([item("guest-delete"), null]),
  ]) {
    const view = fixture(raw);

    assert.throws(() => view.deleteGuestItem("guest-delete"), undefined, raw);

    assert.equal(view.values.get(key), raw);
    assert.deepEqual(view.writes, []);
  }
});

test("an absent item or absent library is already deleted and does not trigger a write", () => {
  for (const raw of [null, "[]", JSON.stringify([item("guest-keep")])]) {
    const view = fixture(raw, { writeError: new Error("No write should be attempted") });

    assert.doesNotThrow(() => view.deleteGuestItem("guest-absent"));

    assert.equal(view.values.get(key) ?? null, raw);
    assert.deepEqual(view.writes, []);
  }
});

test("deleting the final guest item persists an empty library and is idempotent", () => {
  const view = fixture(JSON.stringify([item("guest-delete")]));

  view.deleteGuestItem("guest-delete");
  view.deleteGuestItem("guest-delete");

  assert.equal(view.values.get(key), "[]");
  assert.deepEqual(view.writes, [[key, "[]"]]);
});

test("a later deletion failure keeps that item and all remaining records after earlier success", () => {
  const items = [item("guest-first"), item("guest-second"), item("guest-keep")];
  const error = new Error("Synthetic second write failure");
  const view = fixture(JSON.stringify(items), {
    writeError: (attempt) => (attempt === 2 ? error : null),
  });

  view.deleteGuestItem("guest-first");
  assert.throws(
    () => view.deleteGuestItem("guest-second"),
    (caught) => caught === error,
  );

  assert.deepEqual(JSON.parse(view.values.get(key)), items.slice(1));
  assert.equal(view.writes.length, 2);

  view.deleteGuestItem("guest-second");

  assert.deepEqual(JSON.parse(view.values.get(key)), [items[2]]);
  assert.equal(view.writes.length, 3);
});
